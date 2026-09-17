import { Router } from "express";
import { confirmBooking, listCandidateSlots } from "../lib/calendar.js";
import { prisma } from "../prisma.js";

export const calendarRouter = Router();

calendarRouter.get("/slots", async (req, res) => {
  const repId = String(req.query.repId ?? "priya-shah");
  const slots = await listCandidateSlots(repId);
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
  const result = await confirmBooking({
    leadId,
    slotStart: new Date(slotStart),
    slotEnd: new Date(slotEnd),
    repId: repId || lead.assignedRepId || "priya-shah",
  });
  res.json(result);
});
