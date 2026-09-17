import { z } from "zod";

export const intakeOutputSchema = z.object({
  decisions: z.array(
    z.object({
      text: z.string(),
      sourceQuote: z.string(),
    }),
  ),
  requirements: z.array(z.string()),
  constraints: z.array(z.string()),
  flags: z.array(
    z.object({
      issue: z.string(),
      relatedText: z.string(),
    }),
  ),
});

export const planningTaskSchema = z.object({
  title: z.string(),
  owner: z.string(),
  deadline: z.string(),
  dependencies: z.array(z.string()),
  sourceType: z.enum(["fact", "recommendation", "unresolved_question"]),
  justification: z.string(),
});

export const planningOutputSchema = z.object({
  tasks: z.array(planningTaskSchema),
});

export const reviewOutputSchema = z.object({
  approved: z.boolean(),
  corrections: z.array(
    z.object({
      taskRef: z.string(),
      issue: z.string(),
      requiredFix: z.string(),
    }),
  ),
  summary: z.string(),
});

export const handoffEnvelopeSchema = z.object({
  fromAgent: z.string(),
  toAgent: z.string(),
  contextVersion: z.number().int().positive(),
  payload: z.unknown(),
});

export type IntakeOutput = z.infer<typeof intakeOutputSchema>;
export type PlanningOutput = z.infer<typeof planningOutputSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
