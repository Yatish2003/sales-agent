import type { NormalizedInbound } from "./types.js";

export function normalizeInstagramPayload(body: Record<string, unknown>): NormalizedInbound {
  const messaging = (body.entry as { messaging?: Record<string, unknown>[] }[] | undefined)?.[0]
    ?.messaging?.[0];
  const sender = String((messaging?.sender as { id?: string } | undefined)?.id ?? "ig-unknown");
  const content = String((messaging?.message as { text?: string } | undefined)?.text ?? "");
  return {
    channel: "INSTAGRAM",
    externalContactId: sender,
    displayName: sender,
    content,
    timestamp: new Date(),
  };
}

export async function sendInstagram(to: string, text: string) {
  console.info(`[instagram:outbound:unwired] to=${to} body=${text.slice(0, 180)}`);
}
