import { Router } from "express";
import { env } from "../env.js";
import { handleIncomingMessage } from "../lib/conversationEngine.js";
import { normalizeEmailPayload } from "../lib/channels/email.js";

export const emailWebhookRouter = Router();

emailWebhookRouter.post("/", async (req, res) => {
  if (env.emailWebhookSecret && req.header("x-webhook-secret") !== env.emailWebhookSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const inbound = normalizeEmailPayload(req.body);
  await handleIncomingMessage(inbound);
  res.json({ ok: true });
});
