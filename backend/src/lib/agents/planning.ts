import { completeJson } from "../llm.js";
import { applyCompanyRules, companyRulesPrompt, type ProposedTask } from "../policy/companyRules.js";
import {
  planningOutputSchema,
  type IntakeOutput,
  type PlanningOutput,
  type ReviewOutput,
} from "../schemas/agents.js";

const SYSTEM = `You are the Planning Agent. Turn Intake output + company rules into a task plan.
Output JSON: { tasks: [{ title, owner, deadline (YYYY-MM-DD), dependencies, sourceType: fact|recommendation|unresolved_question, justification }] }.
Do not invent people. Prefer unresolved_question when ownership or a contradiction is unresolved.
${companyRulesPrompt()}`;

export function mockPlanning(intake: IntakeOutput, corrections?: ReviewOutput): PlanningOutput {
  const extra = corrections?.corrections?.length
    ? [
        {
          title: "Resolve legal vs product copy on 'churn prediction'",
          owner: "Jordan Patel",
          deadline: "2026-10-02",
          dependencies: [],
          sourceType: "unresolved_question" as const,
          justification: "Review required an explicit task for the flagged copy conflict.",
        },
      ]
    : [];

  return {
    tasks: [
      {
        title: "Audit dbt models for customer health scores",
        owner: "Samir Okonkwo",
        deadline: "2026-09-25",
        dependencies: [],
        sourceType: "fact",
        justification: "Transcript decision: audit before the Looker freeze.",
      },
      {
        title: "Freeze new Looker explores after Wednesday",
        owner: "Ava Chen",
        deadline: "2026-09-25",
        dependencies: ["Audit dbt models for customer health scores"],
        sourceType: "fact",
        justification: "Ava's stated freeze decision.",
      },
      {
        title: "Write launch email copy using dashboard screenshots",
        owner: "Jordan Patel",
        deadline: "2026-09-25",
        dependencies: ["Freeze new Looker explores after Wednesday"],
        sourceType: "fact",
        justification: "Jordan needs screenshots by Thursday or the email slips.",
      },
      {
        title: "Mock empty states using billing illustration set",
        owner: "Riley Nguyen",
        deadline: "2026-10-09",
        dependencies: [],
        sourceType: "unresolved_question",
        justification: "Required, but no deadline was set in the transcript — flagged.",
      },
      {
        title: "Coordinate legal review of health-score language",
        owner: "Morgan Ellis",
        deadline: "2026-09-25",
        dependencies: [],
        sourceType: "recommendation",
        justification: "Hard legal constraint; coordinator owns until legal returns.",
      },
      {
        title: "Present pipeline audit at customer advisory call",
        owner: "Samir Okonkwo",
        deadline: "2026-10-09",
        dependencies: ["Audit dbt models for customer health scores"],
        sourceType: "fact",
        justification: "Morgan's decision that Samir presents findings.",
      },
      ...extra,
    ],
  };
}

export async function runPlanning(args: {
  intake: IntakeOutput;
  corrections?: ReviewOutput;
  simulateFailure?: boolean;
}): Promise<{ plan: PlanningOutput; ruleFixes: ReturnType<typeof applyCompanyRules>["fixes"] }> {
  const proposed = await completeJson({
    agentName: "planning",
    system: SYSTEM,
    user: JSON.stringify({
      intake: args.intake,
      reviewCorrections: args.corrections ?? null,
    }),
    schema: planningOutputSchema,
    simulateFailure: args.simulateFailure,
  });

  const enforced = applyCompanyRules(proposed.tasks as ProposedTask[]);
  return { plan: { tasks: enforced.tasks }, ruleFixes: enforced.fixes };
}
