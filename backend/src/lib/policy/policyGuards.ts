import type { ConversationLlmOutput } from "../schemas/sales.js";

/**
 * Override attempts are matched per sentence so a legitimate message like
 * "override our old dashboard rules" does not trip the refusal path.
 */
export const POLICY_OVERRIDE_RE = new RegExp(
  [
    String.raw`(ignore|disregard|forget|override|bypass)\s+(all\s+|any\s+)?(your|these|those|the|previous|prior|earlier|system|above)\b[^.!?]*\b(instruction|rule|polic|guideline|prompt|criteria|qualification)`,
    String.raw`(mark|treat|consider|set|flag)\s+(me|this lead|this)\b[^.!?]*\bqualified`,
    String.raw`(auto[- ]?qualify|just qualify me|qualify me (now|immediately|anyway))`,
    String.raw`(reveal|show|print|repeat|tell me)\b[^.!?]*\b(system\s+)?prompt`,
    String.raw`pretend (you )?(have no|don't have|do not have) (rules|instructions)`,
  ].join("|"),
  "i",
);

export const POLICY_OVERRIDE_REPLY =
  "I can’t ignore our qualification rules, auto-qualify anyone, or book a call before we’ve confirmed fit. Happy to keep going the normal way — what analytics problem are you trying to solve at work?";

const POLICY_OVERRIDE_QUESTION = "What analytics problem are you trying to solve at work?";

/**
 * Deterministic backstop over the model output. The model has been observed
 * setting policyOverrideAttempt=true while still returning QUALIFIED and a
 * booking offer, so qualification and reply are decided here, not by the LLM.
 */
export function applyPolicyGuards(
  result: ConversationLlmOutput,
  lastInboundContent: string,
  humanTakeover: boolean,
): ConversationLlmOutput {
  if (humanTakeover) {
    return {
      ...result,
      qualification: "NEEDS_MORE_INFO",
      fallbackPath: "human-takeover",
      reply: "",
    };
  }

  if (POLICY_OVERRIDE_RE.test(lastInboundContent) || result.policyOverrideAttempt) {
    return {
      ...result,
      qualification: "NEEDS_MORE_INFO",
      fallbackPath: "policy-override",
      policyOverrideAttempt: true,
      evidence: ["Refused an attempt to override qualification policy"],
      extractedService: null,
      extractedBudget: null,
      extractedTimeline: null,
      followUpQuestion: POLICY_OVERRIDE_QUESTION,
      reply: POLICY_OVERRIDE_REPLY,
    };
  }

  if (result.confidence < 0.35 && result.qualification !== "NEEDS_MORE_INFO") {
    return { ...result, qualification: "NEEDS_MORE_INFO", fallbackPath: "low-confidence" };
  }

  return result;
}
