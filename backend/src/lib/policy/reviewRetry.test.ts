import { describe, expect, it } from "vitest";
import { applyCompanyRules, MAX_REVIEW_ATTEMPTS, nextReviewDecision } from "./companyRules.js";
import { mockReview } from "../agents/review.js";
import { mockPlanning } from "../agents/planning.js";
import { mockIntake } from "../agents/intake.js";

describe("Review-agent retry cap", () => {
  it("replans while attempts remain", () => {
    expect(nextReviewDecision({ approved: false, attemptNumber: 1 })).toBe("replan");
    expect(nextReviewDecision({ approved: false, attemptNumber: 2 })).toBe("replan");
  });

  it("stops at needs_human_review after the cap", () => {
    expect(nextReviewDecision({ approved: false, attemptNumber: MAX_REVIEW_ATTEMPTS })).toBe(
      "needs_human_review",
    );
    expect(MAX_REVIEW_ATTEMPTS).toBe(3);
  });

  it("approves immediately when Review says so", () => {
    expect(nextReviewDecision({ approved: true, attemptNumber: 1 })).toBe("approved");
  });

  it("mock Review rejects once then approves after the copy-conflict task exists", () => {
    const intake = mockIntake();
    const first = mockPlanning(intake);
    const review1 = mockReview(first, 1);
    expect(review1.approved).toBe(false);
    const second = mockPlanning(intake, review1);
    const review2 = mockReview(second, 2);
    expect(review2.approved).toBe(true);
  });

  it("enforces max-3-per-owner in code after the model proposes", () => {
    const overloaded = applyCompanyRules(
      Array.from({ length: 4 }, (_, i) => ({
        title: `Task ${i}`,
        owner: "Samir Okonkwo",
        deadline: "not-a-date",
        dependencies: [],
        sourceType: "recommendation" as const,
        justification: "test",
      })),
    );
    const samir = overloaded.tasks.filter((t) => t.owner === "Samir Okonkwo");
    expect(samir.length).toBeLessThanOrEqual(3);
    expect(overloaded.fixes.some((f) => f.rule === "max-3-per-owner")).toBe(true);
  });
});
