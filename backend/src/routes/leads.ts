import { Router } from "express";
import { prisma } from "../prisma.js";
import { takeoverLead } from "../lib/conversationEngine.js";
import { handleIncomingMessage } from "../lib/conversationEngine.js";

export const leadsRouter = Router();

leadsRouter.get("/", async (_req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    res.json({
      leads: leads.map((l) => ({
        id: l.id,
        channel: l.channel,
        displayName: l.displayName,
        externalContactId: l.externalContactId,
        status: l.status,
        assignedRepId: l.assignedRepId,
        humanTakeover: l.humanTakeover,
        lastFallback: l.lastFallback,
        lastMessage: l.messages[0]?.content ?? "",
        updatedAt: l.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get("/:id", async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      bookings: true,
      actionLogs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!lead) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ lead });
});

leadsRouter.post("/:id/takeover", async (req, res) => {
  try {
    const lead = await takeoverLead(req.params.id);
    res.json({ lead });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

leadsRouter.post("/simulate-inbound", async (req, res, next) => {
  try {
    const { channel, externalContactId, content, displayName } = req.body as {
      channel: "EMAIL" | "WHATSAPP" | "INSTAGRAM";
      externalContactId: string;
      content: string;
      displayName?: string;
    };
    const lead = await handleIncomingMessage({
      channel,
      externalContactId,
      content,
      displayName,
      timestamp: new Date(),
    });
    res.json({ lead });
  } catch (err) {
    next(err);
  }
});
