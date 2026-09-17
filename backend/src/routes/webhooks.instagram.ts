import { Router } from "express";
import { env } from "../env.js";
import { handleIncomingMessage } from "../lib/conversationEngine.js";
import { normalizeInstagramPayload } from "../lib/channels/instagram.js";

export const instagramWebhookRouter = Router();

instagramWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === env.instagramVerifyToken) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

instagramWebhookRouter.post("/", async (req, res) => {
  if (!env.instagramPageAccessToken) {
    res.status(200).json({
      ok: false,
      incomplete: true,
      blocker:
        "Instagram Messaging API is not connected. HR confirmed WhatsApp via BSP only; Instagram still requires Meta app review. Setup attempted: verify token endpoint is live.",
    });
    return;
  }
  const inbound = normalizeInstagramPayload(req.body as Record<string, unknown>);
  if (inbound.content) await handleIncomingMessage(inbound);
  res.json({ ok: true });
});
