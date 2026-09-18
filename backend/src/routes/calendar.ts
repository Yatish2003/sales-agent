import { Router } from "express";
import { bookSlot, getAvailableSlots } from "../lib/calendar.js";
import { prisma } from "../prisma.js";

export const calendarRouter = Router();

calendarRouter.get("/slots", async (req, res) => {
  const repId = String(req.query.repId ?? "priya-shah");
  const days = Number(req.query.days ?? 10);
  const slots = await getAvailableSlots(repId, Number.isFinite(days) ? days : 10);
  res.json({ slots });
});

calendarRouter.post("/book", async (req, res) => {
  const { leadId, slotStart, slotEnd, repId } = req.body as {
    leadId: string;
    slotStart: string;
    slotEnd: string;
    repId: string;
  };
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const result = await bookSlot(
    leadId,
    repId || lead.assignedRepId || "priya-shah",
    slotStart,
    slotEnd,
  );
  res.json(result);
});
