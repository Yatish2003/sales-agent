import { createHash } from "node:crypto";
import { BookingStatus } from "@prisma/client";
import { google, type calendar_v3 } from "googleapis";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { logAction } from "./actionLog.js";
import { SALES_REPS } from "./policy/businessPolicy.js";

const SLOT_MINUTES = 30;
const DEFAULT_OFFER_COUNT = 5;

export type DisplaySlot = { start: string; end: string };

export type BookSlotResult =
  | { ok: true; outcome: "booked" | "idempotent"; booking: { id: string; googleEventId: string | null } }
  | { ok: false; outcome: "slot_taken"; alternatives: DisplaySlot[] }
  | { ok: false; outcome: "api_failure"; alternatives: DisplaySlot[] };

export function makeIdempotencyKey(leadId: string, slotStart: Date | string): string {
  const iso = typeof slotStart === "string" ? new Date(slotStart).toISOString() : slotStart.toISOString();
  return createHash("sha256").update(`${leadId}${iso}`).digest("hex");
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

function calendarClient(): calendar_v3.Calendar | null {
  if (!env.googleCalendarClientEmail || !env.googleCalendarPrivateKey || !env.googleCalendarId) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: env.googleCalendarClientEmail,
    key: env.googleCalendarPrivateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = asUtc;
  for (let i = 0; i < 3; i++) {
    utc = asUtc - tzOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

function toZonedIso(date: Date, timeZone: string): string {
  const offsetMin = Math.round(tzOffsetMs(date, timeZone) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const wall = new Date(date.getTime() + offsetMin * 60000);
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function ymdInZone(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function weekdayInZone(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }) {
  return a.start < b.end && a.end > b.start;
}

export function workingSlots(repId: string, from: Date, days: number): { start: Date; end: Date }[] {
  const rep = SALES_REPS.find((r) => r.id === repId);
  if (!rep) return [];
  const slots: { start: Date; end: Date }[] = [];
  const startDay = ymdInZone(from, rep.timezone);

  for (let d = 0; d < days; d++) {
    const cursor = new Date(Date.UTC(startDay.year, startDay.month - 1, startDay.day + d, 12, 0, 0));
    const { year, month, day } = ymdInZone(cursor, "UTC");
    const noonLocal = zonedLocalToUtc(rep.timezone, year, month, day, 12, 0);
    const weekday = weekdayInZone(noonLocal, rep.timezone);
    if (!(rep.weekdays as readonly number[]).includes(weekday)) continue;

    for (let hour = rep.workStartHour; hour < rep.workEndHour; hour++) {
      for (const minute of [0, 30]) {
        const start = zonedLocalToUtc(rep.timezone, year, month, day, hour, minute);
        if (start <= from) continue;
        const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);
        const dayEnd = zonedLocalToUtc(rep.timezone, year, month, day, rep.workEndHour, 0);
        if (end > dayEnd) continue;
        slots.push({ start, end });
      }
    }
  }
  return slots;
}

async function queryBusy(
  cal: calendar_v3.Calendar,
  timeMin: Date,
  timeMax: Date,
): Promise<{ start: Date; end: Date }[]> {
  const calendarId = env.googleCalendarId;
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    },
  });
  return (res.data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
    start: new Date(b.start ?? ""),
    end: new Date(b.end ?? ""),
  }));
}

function toDisplay(slots: { start: Date; end: Date }[], timeZone: string): DisplaySlot[] {
  return slots.map((s) => ({
    start: toZonedIso(s.start, timeZone),
    end: toZonedIso(s.end, timeZone),
  }));
}

export async function getAvailableSlots(
  repId: string,
  timeframeInDays = 10,
  leadId?: string,
): Promise<DisplaySlot[]> {
  const rep = SALES_REPS.find((r) => r.id === repId);
  if (!rep) return [];
  const from = new Date();
  const windowEnd = new Date(from);
  windowEnd.setDate(windowEnd.getDate() + timeframeInDays);

  const cal = calendarClient();
  if (!cal) {
    await logAction({
      leadId,
      actor: "calendar",
      action: "calendar_not_configured",
      detail: {
        repId,
        missing: [
          !env.googleCalendarClientEmail && "GOOGLE_CALENDAR_CLIENT_EMAIL",
          !env.googleCalendarPrivateKey && "GOOGLE_CALENDAR_PRIVATE_KEY",
          !env.googleCalendarId && "GOOGLE_CALENDAR_ID",
        ].filter(Boolean),
      },
    });
    return [];
  }

  let busy: { start: Date; end: Date }[] = [];
  try {
    busy = await queryBusy(cal, from, windowEnd);
  } catch (err) {
    await logAction({
      leadId,
      actor: "calendar",
      action: "freebusy_failed",
      detail: { repId, calendarId: env.googleCalendarId, error: String(err) },
    });
    return [];
  }

  const free = workingSlots(repId, from, timeframeInDays)
    .filter((slot) => !busy.some((b) => overlaps(slot, b)))
    .slice(0, DEFAULT_OFFER_COUNT);

  return toDisplay(free, rep.timezone);
}

export async function nextAvailable(repId: string): Promise<Date | null> {
  const offered = await getAvailableSlots(repId, 14);
  return offered[0] ? new Date(offered[0].start) : null;
}

async function slotIsFree(slotStart: Date, slotEnd: Date): Promise<boolean> {
  const cal = calendarClient();
  if (!cal) return false;
  const busy = await queryBusy(cal, slotStart, slotEnd);
  return !busy.some((b) => overlaps({ start: slotStart, end: slotEnd }, b));
}

export function formatSlotOffer(repId: string, slots: DisplaySlot[]): string {
  const rep = SALES_REPS.find((r) => r.id === repId);
  const who = rep ? `${rep.name} (${rep.timezone})` : repId;
  if (slots.length === 0) {
    return `I couldn’t load live calendar times for ${who} right now. Reply and I’ll try again.`;
  }
  const lines = slots.map((s, i) => {
    const start = new Date(s.start);
    const end = new Date(s.end);
    const label = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: rep?.timezone,
    }).format(start);
    const endLabel = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: rep?.timezone,
    }).format(end);
    return `${i + 1}. ${label}–${endLabel}`;
  });
  return `Here are ${slots.length} intro-call times with ${who}. Reply with a number (1–${slots.length}) to book:\n${lines.join("\n")}`;
}

export function parseSlotChoice(content: string, slots: DisplaySlot[]): DisplaySlot | null {
  if (!slots.length) return null;
  const trimmed = content.trim();
  const numbered = trimmed.match(/^(?:slot\s*)?#?\s*([1-5])(?:\b|[.)])/i);
  if (numbered) {
    const idx = Number(numbered[1]) - 1;
    return slots[idx] ?? null;
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  return (
    slots.find((s) => normalized.includes(s.start) || normalized.includes(new Date(s.start).toISOString())) ?? null
  );
}

export async function persistOfferedSlots(leadId: string, slots: DisplaySlot[]) {
  for (const slot of slots) {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const idempotencyKey = makeIdempotencyKey(leadId, start);
    await prisma.calendarBooking.upsert({
      where: { idempotencyKey },
      create: {
        leadId,
        slotStart: start,
        slotEnd: end,
        status: "OFFERED",
        idempotencyKey,
      },
      update: {},
    });
  }
}

export async function loadOfferedSlots(leadId: string): Promise<DisplaySlot[]> {
  const rows = await prisma.calendarBooking.findMany({
    where: { leadId, status: { in: ["OFFERED", "CONFIRMED"] } },
    orderBy: { slotStart: "asc" },
  });
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  const rep = SALES_REPS.find((r) => r.id === lead?.assignedRepId);
  const tz = rep?.timezone ?? "UTC";
  const offered = rows.filter((r) => r.status === "OFFERED");
  const source = offered.length ? offered : rows;
  return source.map((r) => ({
    start: toZonedIso(r.slotStart, tz),
    end: toZonedIso(r.slotEnd, tz),
  }));
}

export async function bookSlot(
  leadId: string,
  repId: string,
  slotStart: Date | string,
  slotEnd: Date | string,
): Promise<BookSlotResult> {
  const start = typeof slotStart === "string" ? new Date(slotStart) : slotStart;
  const end = typeof slotEnd === "string" ? new Date(slotEnd) : slotEnd;
  const idempotencyKey = makeIdempotencyKey(leadId, start);

  const existing = await prisma.calendarBooking.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "CONFIRMED" && existing.googleEventId) {
    await logAction({
      leadId,
      actor: "calendar",
      action: "idempotent_booking",
      detail: { idempotencyKey, googleEventId: existing.googleEventId },
    });
    return { ok: true, outcome: "idempotent", booking: existing };
  }

  const cal = calendarClient();
  if (!cal) {
    await logAction({
      leadId,
      actor: "calendar",
      action: "booking_failed",
      detail: { error: "Google Calendar is not configured" },
    });
    return { ok: false, outcome: "api_failure", alternatives: [] };
  }

  let stillFree = false;
  try {
    stillFree = await slotIsFree(start, end);
  } catch (err) {
    await logAction({
      leadId,
      actor: "calendar",
      action: "booking_failed",
      detail: { error: String(err), stage: "freebusy_recheck" },
    });
    return { ok: false, outcome: "api_failure", alternatives: [] };
  }

  if (!stillFree) {
    await prisma.calendarBooking.upsert({
      where: { idempotencyKey },
      create: {
        leadId,
        slotStart: start,
        slotEnd: end,
        status: "SLOT_TAKEN",
        idempotencyKey,
      },
      update: { status: "SLOT_TAKEN" },
    });
    await logAction({
      leadId,
      actor: "calendar",
      action: "slot_taken",
      detail: { slotStart: start.toISOString() },
    });
    const alternatives = await getAvailableSlots(repId, 10, leadId);
    return { ok: false, outcome: "slot_taken", alternatives };
  }

  try {
    const event = await cal.events.insert({
      calendarId: env.googleCalendarId,
      requestBody: {
        summary: `Northlight intro — lead ${leadId}`,
        description: `Intro call with ${repId}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
    const googleEventId = event.data.id ?? null;
    if (!googleEventId) {
      await logAction({
        leadId,
        actor: "calendar",
        action: "booking_failed",
        detail: { error: "events.insert returned no event id" },
      });
      return { ok: false, outcome: "api_failure", alternatives: [] };
    }

    try {
      const booking = await prisma.calendarBooking.upsert({
        where: { idempotencyKey },
        create: {
          leadId,
          slotStart: start,
          slotEnd: end,
          googleEventId,
          status: "CONFIRMED",
          idempotencyKey,
        },
        update: {
          googleEventId,
          status: "CONFIRMED",
          slotEnd: end,
        },
      });
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: "BOOKED" },
      });
      await logAction({
        leadId,
        actor: "calendar",
        action: "booking_confirmed",
        detail: { googleEventId, idempotencyKey },
      });
      return { ok: true, outcome: "booked", booking };
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "P2002") {
        const winner = await prisma.calendarBooking.findUnique({ where: { idempotencyKey } });
        if (winner?.status === "CONFIRMED" && winner.googleEventId) {
          await logAction({
            leadId,
            actor: "calendar",
            action: "idempotent_booking",
            detail: { idempotencyKey, googleEventId: winner.googleEventId, raced: true },
          });
          return { ok: true, outcome: "idempotent", booking: winner };
        }
      }
      throw err;
    }
  } catch (err) {
    await prisma.calendarBooking.upsert({
      where: { idempotencyKey },
      create: {
        leadId,
        slotStart: start,
        slotEnd: end,
        status: "FAILED",
        idempotencyKey,
      },
      update: { status: existing?.status === "CONFIRMED" ? existing.status : "FAILED" },
    });
    await logAction({
      leadId,
      actor: "calendar",
      action: "booking_failed",
      detail: { error: String(err) },
    });
    return { ok: false, outcome: "api_failure", alternatives: [] };
  }
}

/** @deprecated use getAvailableSlots */
export const listCandidateSlots = async (repId: string, _from?: Date, _count?: number) => {
  const slots = await getAvailableSlots(repId, 14);
  return slots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
};

/** @deprecated use bookSlot */
export async function confirmBooking(args: {
  leadId: string;
  slotStart: Date;
  slotEnd: Date;
  repId: string;
}) {
  return bookSlot(args.leadId, args.repId, args.slotStart, args.slotEnd);
}
