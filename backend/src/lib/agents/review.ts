import { completeJson } from "../llm.js";
import { companyRulesPrompt } from "../policy/companyRules.js";
import { SAMPLE_TRANSCRIPT } from "../sampleData/transcript.js";
import {
  reviewOutputSchema,
  type IntakeOutput,
  type PlanningOutput,
  type ReviewOutput,
} from "../schemas/agents.js";

const SYSTEM = `You are the Review Agent. Compare the plan to the transcript and company rules.
Approve only if:
- every flagged contradiction is either a task or still explicitly unresolved_question
- owners are on the roster
- no owner exceeds 3 concurrent tasks
- deadlines exist
If not approved, list corrections with taskRef, issue, requiredFix.
${companyRulesPrompt()}`;

export function mockReview(plan: PlanningOutput, attemptNumber: number): ReviewOutput {
  const hasConflictTask = plan.tasks.some((t) =>
    t.title.toLowerCase().includes("churn"),
  );
  if (!hasConflictTask && attemptNumber < 2) {
    return {
      approved: false,
      summary: "Plan omits an explicit task for the legal vs product copy conflict.",
      corrections: [
        {
          taskRef: "legal copy conflict",
          issue: "Transcript contains contradictory statements about 'churn prediction' language",
          requiredFix: "Add an unresolved_question task owned by a roster member to resolve legal vs product copy",
        },
      ],
    };
  }
  return {
    approved: true,
    summary: "Plan covers transcript decisions, flags the copy conflict, and respects roster/cap rules.",
    corrections: [],
  };
}

export async function runReview(args: {
  plan: PlanningOutput;
  intake: IntakeOutput;
  transcript?: string;
  attemptNumber: number;
  simulateFailure?: boolean;
}): Promise<ReviewOutput> {
  return completeJson({
    agentName: "review",
    system: SYSTEM,
    user: JSON.stringify({
      transcript: args.transcript ?? SAMPLE_TRANSCRIPT,
      intake: args.intake,
      plan: args.plan,
      attemptNumber: args.attemptNumber,
    }),
    schema: reviewOutputSchema,
    simulateFailure: args.simulateFailure,
  });
}
