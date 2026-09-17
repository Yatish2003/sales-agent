import { createHash } from "node:crypto";
import { BookingStatus } from "@prisma/client";
import { google } from "googleapis";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { logAction } from "./actionLog.js";
import { SALES_REPS } from "./policy/businessPolicy.js";

export function makeIdempotencyKey(leadId: string, slotStart: Date | string): string {
  const iso = typeof slotStart === "string" ? slotStart : slotStart.toISOString();
  return createHash("sha256").update(`${leadId}|${iso}`).digest("hex");
}

export type BookingDecision = "book" | "idempotent_return" | "slot_taken";

export function decideBooking(args: {
  existingStatus: BookingStatus | null;
  slotStillFree: boolean;
}): BookingDecision {
  if (args.existingStatus === "CONFIRMED") return "idempotent_return";
  if (!args.slotStillFree) return "slot_taken";
  return "book";
}

function calendarClient() {
  if (!env.googleCalendarClientEmail || !env.googleCalendarPrivateKey) return null;
  const auth = new google.auth.JWT({
    email: env.googleCalendarClientEmail,
    key: env.googleCalendarPrivateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

function mockBusy(repId: string, windowStart: Date, windowEnd: Date) {
  const busy = [];
  const cursor = new Date(windowStart);
  while (cursor < windowEnd) {
    const day = cursor.getDay();
    if (day >= 1 && day <= 5 && cursor.getHours() === 12) {
      const end = new Date(cursor);
      end.setHours(13, 0, 0, 0);
      busy.push({ start: new Date(cursor), end });
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return busy;
}

export function workingSlots(repId: string, from: Date, days = 10): { start: Date; end: Date }[] {
  const rep = SALES_REPS.find((r) => r.id === repId);
  if (!rep) return [];
  const slots: { start: Date; end: Date }[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  for (let i = 0; i < days * 24; i++) {
    const local = new Date(cursor.toLocaleString("en-US", { timeZone: rep.timezone }));
    const weekday = local.getDay();
    const hour = local.getHours();
    if ((rep.weekdays as readonly number[]).includes(weekday) && hour >= rep.workStartHour && hour < rep.workEndHour) {
      const end = new Date(cursor);
      end.setHours(end.getHours() + 1);
      slots.push({ start: new Date(cursor), end });
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return slots;
}

export async function nextAvailable(repId: string, from = new Date()): Promise<Date | null> {
  const offered = await listCandidateSlots(repId, from, 1);
  return offered[0]?.start ?? null;
}

export async function listCandidateSlots(repId: string, from = new Date(), count = 5) {
  const windowEnd = new Date(from);
  windowEnd.setDate(windowEnd.getDate() + 14);
  const cal = calendarClient();
  let busy: { start: Date; end: Date }[] = [];
  const calendarId =
    repId === "priya-shah" ? env.googleCalendarPriyaId : env.googleCalendarMarcusId;

  if (cal && calendarId) {
    try {
      const res = await cal.freebusy.query({
        requestBody: {
          timeMin: from.toISOString(),
          timeMax: windowEnd.toISOString(),
          items: [{ id: calendarId }],
        },
      });
      busy = (res.data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
        start: new Date(b.start ?? ""),
        end: new Date(b.end ?? ""),
      }));
    } catch (err) {
      await logAction({
        actor: "calendar",
        action: "freebusy_failed",
        detail: { repId, error: String(err) },
      });
      busy = mockBusy(repId, from, windowEnd);
    }
  } else {
    busy = mockBusy(repId, from, windowEnd);
  }

  const overlaps = (slot: { start: Date; end: Date }) =>
    busy.some((b) => slot.start < b.end && slot.end > b.start);

  return workingSlots(repId, from).filter((s) => !overlaps(s)).slice(0, count);
}

export async function confirmBooking(args: {
  leadId: string;
  slotStart: Date;
  slotEnd: Date;
  repId: string;
}) {
  const idempotencyKey = makeIdempotencyKey(args.leadId, args.slotStart);
  const existing = await prisma.calendarBooking.findUnique({ where: { idempotencyKey } });
  const candidates = await listCandidateSlots(args.repId, new Date(args.slotStart.getTime() - 60_000), 8);
  const slotStillFree = candidates.some((c) => c.start.getTime() === args.slotStart.getTime());
  const decision = decideBooking({
    existingStatus: existing?.status ?? null,
    slotStillFree: slotStillFree || Boolean(existing && existing.status === "CONFIRMED"),
  });

  if (decision === "idempotent_return" && existing) {
    await logAction({
      leadId: args.leadId,
      actor: "calendar",
      action: "idempotent_booking",
      detail: { idempotencyKey, googleEventId: existing.googleEventId },
    });
    return { ok: true as const, booking: existing, idempotent: true };
  }

  if (decision === "slot_taken") {
    await logAction({
      leadId: args.leadId,
      actor: "calendar",
      action: "slot_taken",
      detail: { slotStart: args.slotStart.toISOString() },
    });
    const alternatives = await listCandidateSlots(args.repId, new Date(), 5);
    return { ok: false as const, reason: "slot_taken", alternatives };
  }

  const calendarId =
    args.repId === "priya-shah" ? env.googleCalendarPriyaId : env.googleCalendarMarcusId;
  const cal = calendarClient();
  let googleEventId: string | null = null;

  try {
    if (cal && calendarId) {
      const event = await cal.events.insert({
        calendarId,
        requestBody: {
          summary: `Northlight intro — lead ${args.leadId}`,
          start: { dateTime: args.slotStart.toISOString() },
          end: { dateTime: args.slotEnd.toISOString() },
        },
      });
      googleEventId = event.data.id ?? null;
    } else {
      googleEventId = `mock-${idempotencyKey.slice(0, 12)}`;
    }

    const booking = await prisma.calendarBooking.upsert({
      where: { idempotencyKey },
      create: {
        leadId: args.leadId,
        slotStart: args.slotStart,
        slotEnd: args.slotEnd,
        googleEventId,
        status: "CONFIRMED",
        idempotencyKey,
      },
      update: {
        googleEventId,
        status: "CONFIRMED",
        slotEnd: args.slotEnd,
      },
    });
    await prisma.lead.update({
      where: { id: args.leadId },
      data: { status: "BOOKED" },
    });
    await logAction({
      leadId: args.leadId,
      actor: "calendar",
      action: "booking_confirmed",
      detail: { googleEventId, mock: !cal },
    });
    return { ok: true as const, booking, idempotent: false };
  } catch (err) {
    await logAction({
      leadId: args.leadId,
      actor: "calendar",
      action: "booking_failed",
      detail: { error: String(err) },
    });
    return { ok: false as const, reason: "provider_error", alternatives: [] as { start: Date; end: Date }[] };
  }
}
