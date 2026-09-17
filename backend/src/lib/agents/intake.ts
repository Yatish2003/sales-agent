import { completeJson } from "../llm.js";
import { SAMPLE_TRANSCRIPT } from "../sampleData/transcript.js";
import { intakeOutputSchema, type IntakeOutput } from "../schemas/agents.js";

const SYSTEM = `You are the Intake Agent for Northlight internal operations.
Extract only what is supported by the transcript.
Output JSON: { decisions: [{text, sourceQuote}], requirements: string[], constraints: string[], flags: [{issue, relatedText}] }.
Never invent owners or deadlines. If they are missing, add a flag instead.
Flag contradictions and ambiguous statements explicitly.`;

export function mockIntake(): IntakeOutput {
  return {
    decisions: [
      {
        text: "Freeze new Looker explores after Wednesday so launch copy can be written.",
        sourceQuote: "we freeze new Looker explores after Wednesday so Jordan can write the launch copy",
      },
      {
        text: "Audit dbt models for health-score pipeline before the freeze.",
        sourceQuote: "we decided last week to audit the dbt models before the freeze",
      },
      {
        text: "Samir presents pipeline audit findings at the customer advisory call the Friday after next sprint.",
        sourceQuote: "next customer advisory call is the Friday after next sprint, and Samir presents",
      },
    ],
    requirements: [
      "Dashboard screenshots by Thursday for launch email",
      "Empty states reuse the billing illustration set",
    ],
    constraints: [
      "Nobody takes a fourth concurrent task",
      "Health-score copy cannot mention 'churn prediction' until legal reviews",
      "Sprint ends Friday in two weeks",
    ],
    flags: [
      {
        issue: "Conflicting statements about whether in-app copy may say 'churn prediction'",
        relatedText:
          "legal said the health-score copy cannot mention \"churn prediction\" until they review vs Jordan thought we were allowed to say it in the tooltip",
      },
      {
        issue: "Design empty states have no deadline",
        relatedText: "Design will mock the empty states. No deadline was set.",
      },
      {
        issue: "Samir already has three pipeline tickets — fourth task would violate the cap",
        relatedText: "I already have three other pipeline tickets",
      },
    ],
  };
}

export async function runIntake(args: {
  transcript?: string;
  simulateFailure?: boolean;
}): Promise<IntakeOutput> {
  const transcript = args.transcript ?? SAMPLE_TRANSCRIPT;
  return completeJson({
    agentName: "intake",
    system: SYSTEM,
    user: `runId-scoped transcript:\n\n${transcript}`,
    schema: intakeOutputSchema,
    simulateFailure: args.simulateFailure,
  });
}
