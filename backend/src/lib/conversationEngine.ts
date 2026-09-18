import type { Channel } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logAction } from "./actionLog.js";
import { completeJson } from "./llm.js";
import { policySystemPrompt } from "./policy/businessPolicy.js";
import { applyPolicyGuards } from "./policy/policyGuards.js";
import { conversationLlmOutputSchema, type ConversationLlmOutput } from "./schemas/sales.js";
import { routeLead } from "./routing.js";
import {
  bookSlot,
  formatSlotOffer,
  getAvailableSlots,
  loadOfferedSlots,
  nextAvailable,
  parseSlotChoice,
  persistOfferedSlots,
} from "./calendar.js";
import { sendEmail } from "./channels/email.js";
import { sendWhatsapp } from "./channels/whatsapp.js";
import { sendInstagram } from "./channels/instagram.js";
import type { NormalizedInbound } from "./channels/types.js";

async function sendOutbound(channel: Channel, to: string, body: string, leadId?: string) {
  if (channel === "EMAIL") return sendEmail(to, body);
  if (channel === "WHATSAPP") return sendWhatsapp(to, body, leadId);
  return sendInstagram(to, body);
}

export async function persistIncomingMessage(inbound: NormalizedInbound): Promise<{
  leadId: string;
  duplicate: boolean;
}> {
  if (inbound.externalMessageSid) {
    const existing = await prisma.message.findUnique({
      where: { externalMessageSid: inbound.externalMessageSid },
    });
    if (existing) {
      await logAction({
        leadId: existing.leadId,
        actor: "channel",
        action: "inbound_duplicate",
        detail: { externalMessageSid: inbound.externalMessageSid },
      });
      return { leadId: existing.leadId, duplicate: true };
    }
  }

  const lead = await prisma.lead.upsert({
    where: {
      channel_externalContactId: {
        channel: inbound.channel,
        externalContactId: inbound.externalContactId,
      },
    },
    create: {
      channel: inbound.channel,
      externalContactId: inbound.externalContactId,
      displayName: inbound.displayName,
      status: "NEW",
    },
    update: { displayName: inbound.displayName ?? undefined },
  });

  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "INBOUND",
        channel: inbound.channel,
        content: inbound.content,
        externalMessageSid: inbound.externalMessageSid,
      },
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "P2002" && inbound.externalMessageSid) {
      return { leadId: lead.id, duplicate: true };
    }
    throw err;
  }

  await logAction({
    leadId: lead.id,
    actor: "channel",
    action: "inbound",
    detail: { channel: inbound.channel, preview: inbound.content.slice(0, 120) },
  });

  return { leadId: lead.id, duplicate: false };
}

export async function handleIncomingMessage(inbound: NormalizedInbound) {
  const { leadId, duplicate } = await persistIncomingMessage(inbound);
  if (duplicate) {
    return prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }
  return continueConversation(leadId);
}

export async function continueConversation(leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (lead.humanTakeover) {
    await logAction({
      leadId,
      actor: "conversation",
      action: "fallback",
      detail: { path: "human-takeover", note: "automation halted" },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastFallback: "human-takeover", status: "HUMAN_TAKEOVER" },
    });
    return lead;
  }

  const lastInbound = [...lead.messages].reverse().find((m) => m.direction === "INBOUND");

  if (
    lastInbound &&
    lead.assignedRepId &&
    (lead.status === "QUALIFIED" || lead.status === "BOOKED")
  ) {
    const offered = await loadOfferedSlots(leadId);
    const pick = parseSlotChoice(lastInbound.content, offered);
    if (pick) {
      const booked = await bookSlot(leadId, lead.assignedRepId, pick.start, pick.end);
      let reply: string;
      if (booked.ok && booked.outcome === "booked") {
        reply = `You’re booked. I’ll see you at ${pick.start}.`;
      } else if (booked.ok && booked.outcome === "idempotent") {
        reply = `That time is already confirmed — you’re all set for ${pick.start}.`;
      } else if (!booked.ok && booked.outcome === "slot_taken") {
        await persistOfferedSlots(leadId, booked.alternatives);
        reply = `That slot was just taken. ${formatSlotOffer(lead.assignedRepId, booked.alternatives)}`;
      } else {
        reply = "Booking failed, please try again.";
      }
      await prisma.message.create({
        data: {
          leadId,
          direction: "OUTBOUND",
          channel: lead.channel,
          content: reply,
        },
      });
      await sendOutbound(lead.channel, lead.externalContactId, reply, leadId);
      return prisma.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
    }
  }

  const history = lead.messages.map((m) => `${m.direction}: ${m.content}`).join("\n");

  let result: ConversationLlmOutput;
  try {
    result = await completeJson({
      agentName: "sales-conversation",
      system: policySystemPrompt(),
      user: history,
      schema: conversationLlmOutputSchema,
    });
  } catch (err) {
    await logAction({
      leadId,
      actor: "conversation",
      action: "bedrock_error",
      detail: { error: String(err) },
    });
    throw err;
  }

  result = applyPolicyGuards(result, lastInbound?.content ?? "", lead.humanTakeover);

  await logAction({
    leadId,
    actor: "conversation",
    action: "fallback",
    detail: {
      path: result.fallbackPath,
      note:
        result.fallbackPath === "missing-info"
          ? `fallback: missing-info — asked about ${result.followUpQuestion}`
          : `fallback: ${result.fallbackPath}`,
    },
  });

  let assignedRepId = lead.assignedRepId;
  if (result.qualification === "QUALIFIED" && result.extractedService) {
    const nextAvailableByRep: Record<string, Date | null> = {
      "priya-shah": await nextAvailable("priya-shah"),
      "marcus-webb": await nextAvailable("marcus-webb"),
    };
    const routing = routeLead({
      service: result.extractedService,
      nextAvailableByRep,
    });
    if (routing) {
      assignedRepId = routing.assignedRepId;
      await logAction({
        leadId,
        actor: "routing",
        action: "assigned",
        detail: routing,
      });
    }
  }

  const status =
    result.qualification === "QUALIFIED"
      ? "QUALIFIED"
      : result.qualification === "NOT_QUALIFIED"
        ? "NOT_QUALIFIED"
        : "NEEDS_MORE_INFO";

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status,
      assignedRepId,
      qualificationEvidence: result,
      extractedService: result.extractedService ?? undefined,
      extractedBudget: result.extractedBudget ?? undefined,
      extractedTimeline: result.extractedTimeline ?? undefined,
      lastFallback: result.fallbackPath,
    },
  });

  let outbound = result.reply;
  if (status === "QUALIFIED" && assignedRepId) {
    const slots = await getAvailableSlots(assignedRepId, 10, leadId);
    await persistOfferedSlots(leadId, slots);
    await logAction({
      leadId,
      actor: "calendar",
      action: slots.length ? "slots_offered" : "slots_unavailable",
      detail: { repId: assignedRepId, slots },
    });
    const offer = formatSlotOffer(assignedRepId, slots);
    outbound = outbound ? `${outbound}\n\n${offer}` : offer;
  }

  if (outbound) {
    await prisma.message.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        channel: lead.channel,
        content: outbound,
      },
    });
    await sendOutbound(lead.channel, lead.externalContactId, outbound, leadId);
  }

  return prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function takeoverLead(leadId: string) {
  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: { humanTakeover: true, status: "HUMAN_TAKEOVER", lastFallback: "human-takeover" },
  });
  await logAction({
    leadId,
    actor: "human",
    action: "takeover",
    detail: { path: "human-takeover" },
  });
  return lead;
}
