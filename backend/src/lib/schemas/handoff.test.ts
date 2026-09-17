import { describe, expect, it } from "vitest";
import {
  intakeOutputSchema,
  planningOutputSchema,
  reviewOutputSchema,
} from "./agents.js";
import { mockIntake } from "../agents/intake.js";
import { mockPlanning } from "../agents/planning.js";

describe("Zod validation on agent handoffs", () => {
  it("accepts a valid Intake → Planning payload", () => {
    const parsed = intakeOutputSchema.safeParse(mockIntake());
    expect(parsed.success).toBe(true);
  });

  it("rejects Intake output that invents a malformed flag", () => {
    const parsed = intakeOutputSchema.safeParse({
      decisions: [],
      requirements: [],
      constraints: [],
      flags: [{ issue: "x" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts Planning output that Review can consume", () => {
    const plan = mockPlanning(mockIntake());
    expect(planningOutputSchema.safeParse(plan).success).toBe(true);
    expect(plan.tasks.every((t) => ["fact", "recommendation", "unresolved_question"].includes(t.sourceType))).toBe(
      true,
    );
  });

  it("rejects a review handoff missing corrections shape", () => {
    const parsed = reviewOutputSchema.safeParse({ approved: false });
    expect(parsed.success).toBe(false);
  });
});
