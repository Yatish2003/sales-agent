import type { NormalizedInbound } from "./types.js";

export function normalizeEmailPayload(body: Record<string, unknown>): NormalizedInbound {
  const from = String(body.from ?? body.sender ?? "unknown@example.com");
  const content = String(body.text ?? body.plain ?? body.content ?? "");
  return {
    channel: "EMAIL",
    externalContactId: from,
    displayName: String(body.name ?? from),
    content,
    timestamp: body.timestamp ? new Date(String(body.timestamp)) : new Date(),
  };
}

export async function sendEmail(to: string, body: string) {
  console.info(`[email:outbound] to=${to} body=${body.slice(0, 180)}`);
}
