import { describe, expect, it } from "vitest";
import { routeLead } from "../lib/routing.js";

describe("routing rules engine", () => {
  const priya = new Date("2026-09-18T04:30:00.000Z");
  const marcus = new Date("2026-09-18T14:00:00.000Z");

  it("routes Dashboard Build and Fractional Support to Priya", () => {
    const dash = routeLead({
      service: "Dashboard Build",
      nextAvailableByRep: { "priya-shah": priya, "marcus-webb": marcus },
    });
    const frac = routeLead({
      service: "Fractional Analytics Support",
      nextAvailableByRep: { "priya-shah": priya, "marcus-webb": marcus },
    });
    expect(dash?.assignedRepId).toBe("priya-shah");
    expect(frac?.assignedRepId).toBe("priya-shah");
    expect(dash?.overrideReason).toBeNull();
  });

  it("routes Data Pipeline Audit to Marcus", () => {
    const r = routeLead({
      service: "Data Pipeline Audit",
      nextAvailableByRep: { "priya-shah": priya, "marcus-webb": marcus },
    });
    expect(r?.assignedRepId).toBe("marcus-webb");
  });

  it("overflows to the other rep when primary has no slot", () => {
    const r = routeLead({
      service: "Dashboard Build",
      nextAvailableByRep: { "priya-shah": null, "marcus-webb": marcus },
    });
    expect(r?.assignedRepId).toBe("marcus-webb");
    expect(r?.overrideReason).toMatch(/overflow/i);
  });

  it("returns null until a service is known", () => {
    expect(
      routeLead({
        service: null,
        nextAvailableByRep: { "priya-shah": priya, "marcus-webb": marcus },
      }),
    ).toBeNull();
  });
});
