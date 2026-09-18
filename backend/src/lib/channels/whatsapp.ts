import Twilio from "twilio";
import { env } from "../../env.js";
import { logAction } from "../actionLog.js";
import type { NormalizedInbound } from "./types.js";

export function normalizeWhatsappPayload(body: Record<string, unknown>): NormalizedInbound {
  const from = String(body.From ?? body.from ?? "");
  const content = String(body.Body ?? body.body ?? "");
  const sid = String(body.MessageSid ?? body.SmsMessageSid ?? "").trim();
  return {
    channel: "WHATSAPP",
    externalContactId: from,
    displayName: String(body.ProfileName ?? from),
    content,
    timestamp: new Date(),
    externalMessageSid: sid || undefined,
  };
}

export async function sendWhatsapp(to: string, text: string, leadId?: string) {
  return sendWhatsappMessage(to, text, leadId);
}

export async function sendWhatsappMessage(to: string, body: string, leadId?: string) {
  if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioWhatsappNumber) {
    await logAction({
      leadId,
      actor: "whatsapp",
      action: "whatsapp_send_skipped",
      detail: { to, reason: "missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_NUMBER" },
    });
    return;
  }

  try {
    const client = Twilio(env.twilioAccountSid, env.twilioAuthToken);
    await client.messages.create({
      from: env.twilioWhatsappNumber,
      to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
      body,
    });
  } catch (err) {
    await logAction({
      leadId,
      actor: "whatsapp",
      action: "whatsapp_send_failed",
      detail: { to, error: String(err) },
    });
  }
}
