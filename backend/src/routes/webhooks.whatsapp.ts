import { Router } from "express";
import twilio from "twilio";
import { env } from "../env.js";
import { logAction } from "../lib/actionLog.js";
import { continueConversation, persistIncomingMessage } from "../lib/conversationEngine.js";
import { normalizeWhatsappPayload } from "../lib/channels/whatsapp.js";

export const whatsappWebhookRouter = Router();

function asTwilioParams(body: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params[key] = typeof value === "string" ? value : String(value);
  }
  return params;
}

whatsappWebhookRouter.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (env.twilioAuthToken && env.twilioWebhookUrl) {
    const signature = String(req.header("X-Twilio-Signature") ?? "");
    const valid = twilio.validateRequest(
      env.twilioAuthToken,
      signature,
      env.twilioWebhookUrl,
      asTwilioParams(body),
    );
    if (!valid) {
      const detail = {
        configuredUrl: env.twilioWebhookUrl,
        hasSignature: Boolean(signature),
        from: String(body.From ?? ""),
        messageSid: String(body.MessageSid ?? ""),
      };
      console.warn("whatsapp signature rejected", detail);
      await logAction({ actor: "whatsapp", action: "whatsapp_signature_rejected", detail });
      res.status(403).json({ error: "invalid_twilio_signature" });
      return;
    }
  }

  const inbound = normalizeWhatsappPayload(body);
  console.log("whatsapp inbound", {
    from: inbound.externalContactId,
    messageSid: inbound.externalMessageSid,
    length: inbound.content.length,
  });
  const { leadId, duplicate } = await persistIncomingMessage(inbound);

  res.set("Content-Type", "text/xml");
  res.status(200).send("<Response></Response>");

  if (duplicate) return;

  void continueConversation(leadId).catch(async (err) => {
    await logAction({
      leadId,
      actor: "whatsapp",
      action: "whatsapp_background_failed",
      detail: { error: String(err) },
    });
  });
});
