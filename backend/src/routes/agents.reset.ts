import { Router } from "express";
import { resetSession } from "../lib/agents/orchestrator.js";

export const agentsResetRouter = Router();

agentsResetRouter.post("/", async (req, res) => {
  const sessionId = req.header("x-session-id") || req.body?.sessionId || "anonymous";
  const result = await resetSession(sessionId);
  res.json(result);
});
