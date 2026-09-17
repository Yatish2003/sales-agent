import { describe, expect, it } from "vitest";
import { decideBooking, makeIdempotencyKey } from "./calendar.js";

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
