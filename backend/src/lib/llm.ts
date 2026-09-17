import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { ZodType } from "zod";
import { env } from "../env.js";

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};

// Claude 3 Haiku on-demand list prices (USD / token); usage endpoint is approximate.
const HAIKU_IN = 0.25 / 1_000_000;
const HAIKU_OUT = 1.25 / 1_000_000;

let lastUsage: LlmUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
let cumulativeUsage: LlmUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };

export function getLlmUsage() {
  return { last: lastUsage, cumulative: cumulativeUsage };
}

function recordUsage(inputTokens: number, outputTokens: number) {
  const estimatedUsd = inputTokens * HAIKU_IN + outputTokens * HAIKU_OUT;
  lastUsage = { inputTokens, outputTokens, estimatedUsd };
  cumulativeUsage = {
    inputTokens: cumulativeUsage.inputTokens + inputTokens,
    outputTokens: cumulativeUsage.outputTokens + outputTokens,
    estimatedUsd: cumulativeUsage.estimatedUsd + estimatedUsd,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimulatedLlmFailure extends Error {
  constructor(agentName: string) {
    super(`SIMULATED FAILURE: LLM call for ${agentName} threw by request`);
    this.name = "SimulatedLlmFailure";
  }
}

type CompleteJsonArgs<T> = {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxRetries?: number;
  simulateFailure?: boolean;
  agentName?: string;
};

const client = new BedrockRuntimeClient({
  region: env.awsRegion || "us-east-1",
});

async function converse(system: string, messages: Message[]) {
  if (!env.awsRegion || !env.bedrockModelId) {
    throw new Error("Bedrock is not configured: set AWS_REGION and BEDROCK_MODEL_ID");
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("Bedrock is not configured: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  }
  const res = await client.send(
    new ConverseCommand({
      modelId: env.bedrockModelId,
      system: [{ text: system }],
      messages,
      inferenceConfig: { maxTokens: 4096, temperature: 0 },
    }),
  );
  const text =
    res.output?.message?.content
      ?.map((b) => ("text" in b && b.text ? b.text : ""))
      .join("") ?? "";
  recordUsage(res.usage?.inputTokens ?? 0, res.usage?.outputTokens ?? 0);
  return text;
}

export async function completeJson<T>(args: CompleteJsonArgs<T>): Promise<T> {
  const { system, user, schema, maxRetries = 3, simulateFailure, agentName = "unknown" } = args;

  if (simulateFailure) {
    throw new SimulatedLlmFailure(agentName);
  }

  const systemWithJson = `${system}\n\nRespond with a single JSON object only. No markdown, no prose.`;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const text = await converse(systemWithJson, [{ role: "user", content: [{ text: user }] }]);
      const first = schema.safeParse(extractJson(text));
      if (first.success) return first.data;

      const retryText = await converse(systemWithJson, [
        { role: "user", content: [{ text: user }] },
        { role: "assistant", content: [{ text }] },
        {
          role: "user",
          content: [
            {
              text: `Your previous response was not valid JSON for the required schema. Errors:\n${first.error.message}\nReturn ONLY valid JSON.`,
            },
          ],
        },
      ]);
      const second = schema.safeParse(extractJson(retryText));
      if (second.success) return second.data;
      lastError = second.error;
    } catch (err) {
      lastError = err;
      await sleep(400 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in LLM response");
  return JSON.parse(raw.slice(start, end + 1));
}
