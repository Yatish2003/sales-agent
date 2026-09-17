import { z } from "zod";

export const qualificationSchema = z.enum([
  "QUALIFIED",
  "NOT_QUALIFIED",
  "NEEDS_MORE_INFO",
]);

export const fallbackPathSchema = z.enum([
  "none",
  "missing-info",
  "ambiguous",
  "policy-override",
  "low-confidence",
  "human-takeover",
]);

export const conversationLlmOutputSchema = z.object({
  qualification: qualificationSchema,
  evidence: z.array(z.string()),
  followUpQuestion: z.string().optional(),
  extractedService: z
    .enum(["Dashboard Build", "Data Pipeline Audit", "Fractional Analytics Support"])
    .nullable()
    .optional(),
  extractedBudget: z.string().nullable().optional(),
  extractedTimeline: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  fallbackPath: fallbackPathSchema,
  policyOverrideAttempt: z.boolean(),
  reply: z.string(),
});

export type ConversationLlmOutput = z.infer<typeof conversationLlmOutputSchema>;
