import { Router } from "express";
import {
  armSimulatedFailure,
  correctFact,
  getRunState,
  listSessionRuns,
  startRun,
  subscribeRun,
} from "../lib/agents/orchestrator.js";
import { SAMPLE_TRANSCRIPT } from "../lib/sampleData/transcript.js";
import { getLlmUsage } from "../lib/llm.js";

export const agentsRunRouter = Router();

function sessionId(req: { header: (n: string) => string | undefined; body?: { sessionId?: string } }) {
  return req.header("x-session-id") || req.body?.sessionId || "anonymous";
}

agentsRunRouter.get("/transcript", (_req, res) => {
  res.json({ transcript: SAMPLE_TRANSCRIPT });
});

agentsRunRouter.get("/usage", (_req, res) => {
  res.json(getLlmUsage());
});

agentsRunRouter.get("/session", async (req, res) => {
  const runs = await listSessionRuns(sessionId(req));
  res.json({ runs });
});

agentsRunRouter.post("/run", async (req, res) => {
  const runId = await startRun(sessionId(req));
  res.json({ runId });
});

agentsRunRouter.get("/:runId/stream", async (req, res) => {
  const { runId } = req.params;
  const state = await getRunState(runId);
  if (!state) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);
  const unsub = subscribeRun(runId, (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
  req.on("close", unsub);
});

agentsRunRouter.get("/:runId", async (req, res) => {
  const state = await getRunState(req.params.runId);
  if (!state) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ run: state });
});

agentsRunRouter.post("/:runId/correct-fact", async (req, res) => {
  const { path, value } = req.body as { path: string; value: string };
  await correctFact(req.params.runId, { path, value });
  res.json({ ok: true });
});

agentsRunRouter.post("/:runId/simulate-failure", async (req, res) => {
  const agentName = String(req.body?.agentName ?? "planning");
  await armSimulatedFailure(req.params.runId, agentName);
  res.json({ ok: true });
});
