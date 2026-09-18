import { describe, expect, it } from "vitest";
import { decideBooking, makeIdempotencyKey, parseSlotChoice, workingSlots } from "./calendar.js";

describe("idempotent booking", () => {
  it("hashes leadId + slotStart stably", () => {
    const a = makeIdempotencyKey("lead-1", "2026-09-18T10:00:00.000Z");
    const b = makeIdempotencyKey("lead-1", new Date("2026-09-18T10:00:00.000Z"));
    const c = makeIdempotencyKey("lead-2", "2026-09-18T10:00:00.000Z");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("returns the existing booking on repeated confirmation", () => {
    expect(decideBooking({ existingStatus: "CONFIRMED", slotStillFree: false })).toBe(
      "idempotent_return",
    );
  });

  it("refuses to book when the slot was taken in the meantime", () => {
    expect(decideBooking({ existingStatus: null, slotStillFree: false })).toBe("slot_taken");
  });

  it("books when the slot is free and unused", () => {
    expect(decideBooking({ existingStatus: null, slotStillFree: true })).toBe("book");
  });
});

describe("workingSlots", () => {
  it("emits 30-minute Priya slots inside Asia/Kolkata 10:00–18:00", () => {
    const from = new Date("2026-09-20T00:00:00.000Z");
    const slots = workingSlots("priya-shah", from, 3);
    const firstMonday = slots.find((s) => s.start.toISOString() === "2026-09-21T04:30:00.000Z");
    expect(firstMonday).toBeTruthy();
    expect(firstMonday?.end.toISOString()).toBe("2026-09-21T05:00:00.000Z");
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 30 * 60_000)).toBe(true);
  });
});

describe("parseSlotChoice", () => {
  const slots = [
    { start: "2026-09-21T10:00:00+05:30", end: "2026-09-21T10:30:00+05:30" },
    { start: "2026-09-21T10:30:00+05:30", end: "2026-09-21T11:00:00+05:30" },
  ];

  it("maps a numbered reply to the offered slot", () => {
    expect(parseSlotChoice("2", slots)).toEqual(slots[1]);
    expect(parseSlotChoice("slot 1", slots)).toEqual(slots[0]);
  });

  it("ignores messages that are not a slot pick", () => {
    expect(parseSlotChoice("can we talk next month?", slots)).toBeNull();
  });
});
