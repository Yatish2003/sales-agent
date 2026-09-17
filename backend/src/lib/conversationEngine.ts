import type { Channel } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logAction } from "./actionLog.js";
import { completeJson } from "./llm.js";
import { policySystemPrompt } from "./policy/businessPolicy.js";
import { conversationLlmOutputSchema, type ConversationLlmOutput } from "./schemas/sales.js";
import { routeLead } from "./routing.js";
import { nextAvailable } from "./calendar.js";
import { sendEmail } from "./channels/email.js";
import { sendWhatsapp } from "./channels/whatsapp.js";
import { sendInstagram } from "./channels/instagram.js";
import type { NormalizedInbound } from "./channels/types.js";

const POLICY_OVERRIDE_RE =
  /ignore (previous|all) instructions|ignore your rules|just qualify me|reveal (your )?(system )?prompt|auto-qualify/i;

function detectFallback(content: string, takeover: boolean): ConversationLlmOutput["fallbackPath"] | null {
  if (takeover) return "human-takeover";
  if (POLICY_OVERRIDE_RE.test(content)) return "policy-override";
  return null;
}

function mockConversation(content: string, takeover: boolean): ConversationLlmOutput {
  const forced = detectFallback(content, takeover);
  if (forced === "human-takeover") {
    return {
      qualification: "NEEDS_MORE_INFO",
      evidence: ["Human takeover is active"],
      confidence: 1,
      fallbackPath: "human-takeover",
      policyOverrideAttempt: false,
      reply: "",
    };
  }
  if (forced === "policy-override") {
    return {
      qualification: "NEEDS_MORE_INFO",
      evidence: ["User attempted to override qualification policy"],
      confidence: 1,
      fallbackPath: "policy-override",
      policyOverrideAttempt: true,
      followUpQuestion: "I can’t ignore our qualification rules. What analytics problem are you trying to solve at work?",
      reply:
        "I can’t ignore our qualification rules or auto-qualify anyone. Happy to keep going the normal way — what analytics problem are you trying to solve at work?",
    };
  }
  if (/weather|joke|recipe|sports/i.test(content)) {
    return {
      qualification: "NEEDS_MORE_INFO",
      evidence: ["Message does not map to a Northlight service"],
      confidence: 0.4,
      fallbackPath: "ambiguous",
      policyOverrideAttempt: false,
      followUpQuestion: "Are you looking for a dashboard build, a data pipeline audit, or fractional analytics support?",
      reply:
        "I’m not sure that maps to one of our services. Are you looking for a dashboard build, a data pipeline audit, or ongoing fractional analytics support?",
    };
  }
  const hasBudget = /\$|budget|k\b|retainer/i.test(content);
  const hasTeam = /team|company|we |our |startup|org/i.test(content);
  const hasTimeline = /week|month|asap|quarter|soon/i.test(content);
  const hasProblem = /dashboard|pipeline|looker|powerbi|analytics|report/i.test(content);

  if (hasProblem && hasTeam && hasBudget && hasTimeline) {
    const service = /pipeline/i.test(content)
      ? ("Data Pipeline Audit" as const)
      : /fractional|retainer|ongoing/i.test(content)
        ? ("Fractional Analytics Support" as const)
        : ("Dashboard Build" as const);
    return {
      qualification: "QUALIFIED",
      evidence: [
        "Specific service-shaped problem",
        "Company/team language present",
        "Budget mentioned or discussed",
        "Timeline within ~3 months",
      ],
      extractedService: service,
      extractedBudget: hasBudget ? content.slice(0, 80) : null,
      extractedTimeline: hasTimeline ? "within 3 months" : null,
      confidence: 0.86,
      fallbackPath: "none",
      policyOverrideAttempt: false,
      reply: "You’re a fit for Northlight. I’ll route you to the right specialist and share a few intro-call times.",
    };
  }

  const missing = [
    !hasProblem && "what problem you’re trying to solve",
    !hasTeam && "whether this is for a company team",
    !hasBudget && "an approximate budget or willingness to discuss one",
    !hasTimeline && "whether you need this within the next 3 months",
  ].filter(Boolean) as string[];

  return {
    qualification: "NEEDS_MORE_INFO",
    evidence: [`Unknown: ${missing[0]}`],
    confidence: 0.55,
    fallbackPath: "missing-info",
    policyOverrideAttempt: false,
    followUpQuestion: `Could you tell me ${missing[0]}?`,
    reply: `Could you tell me ${missing[0]}?`,
  };
}

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

  const forced = detectFallback(lastInbound?.content ?? "", lead.humanTakeover);
  if (forced) {
    result = { ...result, fallbackPath: forced, policyOverrideAttempt: forced === "policy-override" };
    if (forced === "policy-override") {
      result.qualification = "NEEDS_MORE_INFO";
      result.reply =
        result.reply ||
        "I can’t ignore our qualification rules. What analytics problem are you trying to solve at work?";
    }
  }
  if (result.confidence < 0.35 && result.qualification !== "NEEDS_MORE_INFO") {
    result = {
      ...result,
      qualification: "NEEDS_MORE_INFO",
      fallbackPath: "low-confidence",
    };
  }

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

  if (result.reply) {
    await prisma.message.create({
      data: {
        leadId,
        direction: "OUTBOUND",
        channel: lead.channel,
        content: result.reply,
      },
    });
    await sendOutbound(lead.channel, lead.externalContactId, result.reply, leadId);
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
