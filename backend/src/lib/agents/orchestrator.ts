import { prisma } from "../../prisma.js";
import { logAction } from "../actionLog.js";
import { SimulatedLlmFailure } from "../llm.js";
import { SAMPLE_TRANSCRIPT } from "../sampleData/transcript.js";
import { MAX_REVIEW_ATTEMPTS, nextReviewDecision } from "../policy/companyRules.js";
import {
  intakeOutputSchema,
  planningOutputSchema,
  reviewOutputSchema,
  type IntakeOutput,
  type PlanningOutput,
  type ReviewOutput,
} from "../schemas/agents.js";
import { runIntake } from "./intake.js";
import { runPlanning } from "./planning.js";
import { runReview } from "./review.js";
import { randomUUID } from "node:crypto";

const subscribers = new Map<string, Set<(event: string, data: unknown) => void>>();

export function subscribeRun(runId: string, fn: (event: string, data: unknown) => void) {
  const set = subscribers.get(runId) ?? new Set();
  set.add(fn);
  subscribers.set(runId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) subscribers.delete(runId);
  };
}

function emit(runId: string, event: string, data: unknown) {
  for (const fn of subscribers.get(runId) ?? []) fn(event, data);
}

async function persistHandoff(args: {
  runId: string;
  fromAgent: string;
  toAgent: string;
  payload: unknown;
  contextVersion: number;
  schema: { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } };
}) {
  const parsed = args.schema.safeParse(args.payload);
  const validationStatus = parsed.success ? "valid" : `invalid: ${parsed.error?.message ?? "unknown"}`;
  const row = await prisma.handoffMessage.create({
    data: {
      runId: args.runId,
      fromAgent: args.fromAgent,
      toAgent: args.toAgent,
      payloadJson: args.payload as object,
      validationStatus,
      contextVersion: args.contextVersion,
    },
  });
  await logAction({
    runId: args.runId,
    actor: args.fromAgent,
    action: "handoff",
    detail: { to: args.toAgent, validationStatus, contextVersion: args.contextVersion },
  });
  emit(args.runId, "handoff", row);
  if (!parsed.success) {
    throw new Error(`Handoff ${args.fromAgent}→${args.toAgent} failed validation`);
  }
  return row;
}

export async function startRun(sessionId: string) {
  const runId = randomUUID();
  const transcript = SAMPLE_TRANSCRIPT;
  await prisma.agentRun.create({
    data: {
      runId,
      sessionId,
      transcriptSource: transcript,
      status: "running",
    },
  });
  await prisma.agentContext.create({
    data: {
      runId,
      version: 1,
      sourceFactsJson: { transcript, notes: "Initial context v1 from sample transcript" },
    },
  });
  await logAction({
    runId,
    actor: "orchestrator",
    action: "run_started",
    detail: { sessionId, contextVersion: 1 },
  });
  void executeRun(runId).catch(async (err) => {
    await prisma.agentRun.update({
      where: { runId },
      data: { status: "error" },
    });
    await logAction({
      runId,
      actor: "orchestrator",
      action: "run_error",
      detail: { error: String(err) },
    });
    emit(runId, "error", { error: String(err) });
  });
  return runId;
}

export async function correctFact(runId: string, factEdit: { path: string; value: string }) {
  const latest = await prisma.agentContext.findFirst({
    where: { runId },
    orderBy: { version: "desc" },
  });
  if (!latest) throw new Error("Run not found");
  const prev = latest.sourceFactsJson as { transcript: string; notes?: string; edits?: unknown[] };
  const nextVersion = latest.version + 1;
  const editedTranscript = `${prev.transcript}\n\n[FACT CORRECTION v${nextVersion}] ${factEdit.path}: ${factEdit.value}`;
  await prisma.agentContext.create({
    data: {
      runId,
      version: nextVersion,
      sourceFactsJson: {
        transcript: editedTranscript,
        notes: `context v${nextVersion} triggered rerun of Planning + Review`,
        edits: [...(Array.isArray(prev.edits) ? prev.edits : []), factEdit] as object[],
      },
    },
  });
  await prisma.agentRun.update({ where: { runId }, data: { status: "running" } });
  await logAction({
    runId,
    actor: "orchestrator",
    action: "context_version_bump",
    detail: {
      from: latest.version,
      to: nextVersion,
      message: `context v${nextVersion} triggered rerun of Planning + Review`,
      factEdit,
    },
  });
  void executeRun(runId, { reuseIntakeFromVersion: latest.version }).catch(async (err) => {
    await prisma.agentRun.update({ where: { runId }, data: { status: "error" } });
    emit(runId, "error", { error: String(err) });
  });
}

export async function armSimulatedFailure(runId: string, agentName: string) {
  await prisma.agentRun.update({
    where: { runId },
    data: { simulateFailure: agentName, status: "running" },
  });
  await logAction({
    runId,
    actor: "orchestrator",
    action: "simulated_failure_armed",
    detail: { agentName, label: "SIMULATED FAILURE" },
  });
  void executeRun(runId, { forceRerunFrom: agentName }).catch(async (err) => {
    await logAction({
      runId,
      actor: "orchestrator",
      action: "simulated_failure_caught",
      detail: { error: String(err), label: "SIMULATED FAILURE" },
    });
    await prisma.agentRun.update({
      where: { runId },
      data: { simulateFailure: null },
    });
    await logAction({
      runId,
      actor: "orchestrator",
      action: "simulated_failure_recovery",
      detail: { retrying: true },
    });
    void executeRun(runId, { forceRerunFrom: agentName }).catch(async (e) => {
      await prisma.agentRun.update({ where: { runId }, data: { status: "error" } });
      emit(runId, "error", { error: String(e) });
    });
  });
}

export async function resetSession(sessionId: string) {
  const runs = await prisma.agentRun.findMany({ where: { sessionId } });
  const ids = runs.map((r) => r.runId);
  if (ids.length === 0) return { deleted: 0 };
  await prisma.handoffMessage.deleteMany({ where: { runId: { in: ids } } });
  await prisma.agentOutput.deleteMany({ where: { runId: { in: ids } } });
  await prisma.agentContext.deleteMany({ where: { runId: { in: ids } } });
  await prisma.actionLogEntry.deleteMany({ where: { runId: { in: ids } } });
  await prisma.agentRun.deleteMany({ where: { sessionId } });
  return { deleted: ids.length };
}

async function latestOutput(runId: string, agentName: string, version: number) {
  return prisma.agentOutput.findFirst({
    where: { runId, agentName, contextVersion: version, status: "success" },
    orderBy: { attemptNumber: "desc" },
  });
}

export async function executeRun(
  runId: string,
  opts: { reuseIntakeFromVersion?: number; forceRerunFrom?: string } = {},
) {
  const run = await prisma.agentRun.findUnique({ where: { runId } });
  if (!run) throw new Error("Run not found");
  const context = await prisma.agentContext.findFirst({
    where: { runId },
    orderBy: { version: "desc" },
  });
  if (!context) throw new Error("No context");
  const version = context.version;
  const facts = context.sourceFactsJson as { transcript: string };
  const failOn = run.simulateFailure;

  emit(runId, "status", { status: "running", contextVersion: version });

  let intake: IntakeOutput;
  const existingIntake =
    opts.forceRerunFrom && ["intake", "planning", "review"].includes(opts.forceRerunFrom)
      ? null
      : await latestOutput(runId, "intake", opts.reuseIntakeFromVersion ?? version);

  if (existingIntake && opts.reuseIntakeFromVersion && opts.reuseIntakeFromVersion !== version) {
    intake = intakeOutputSchema.parse(existingIntake.outputJson);
    await prisma.agentOutput.create({
      data: {
        runId,
        agentName: "intake",
        contextVersion: version,
        inputJson: { reusedFromVersion: opts.reuseIntakeFromVersion },
        outputJson: intake,
        status: "success",
        attemptNumber: 1,
      },
    });
    await logAction({
      runId,
      actor: "orchestrator",
      action: "resume_skip",
      detail: { agent: "intake", reusedFromVersion: opts.reuseIntakeFromVersion },
    });
  } else if (existingIntake && !opts.forceRerunFrom) {
    intake = intakeOutputSchema.parse(existingIntake.outputJson);
    await logAction({
      runId,
      actor: "orchestrator",
      action: "resume_skip",
      detail: { agent: "intake", contextVersion: version },
    });
  } else {
    emit(runId, "agent", { agent: "intake", status: "running" });
    try {
      intake = await runIntake({
        transcript: facts.transcript,
        simulateFailure: failOn === "intake",
      });
    } catch (err) {
      if (err instanceof SimulatedLlmFailure) throw err;
      throw err;
    }
    await prisma.agentOutput.create({
      data: {
        runId,
        agentName: "intake",
        contextVersion: version,
        inputJson: { transcript: facts.transcript },
        outputJson: intake,
        status: "success",
        attemptNumber: 1,
      },
    });
    emit(runId, "agent", { agent: "intake", status: "done", output: intake });
  }

  await persistHandoff({
    runId,
    fromAgent: "intake",
    toAgent: "planning",
    payload: intake,
    contextVersion: version,
    schema: intakeOutputSchema,
  });

  let corrections: ReviewOutput | undefined;
  let plan: PlanningOutput | undefined;
  let lastReview: ReviewOutput | undefined;
  let terminal: "approved" | "needs_human_review" = "needs_human_review";

  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    emit(runId, "agent", { agent: "planning", status: "running", attempt });
    const planningResult = await runPlanning({
      intake,
      corrections,
      simulateFailure: failOn === "planning" && attempt === 1,
    });
    plan = planningResult.plan;
    await prisma.agentOutput.create({
      data: {
        runId,
        agentName: "planning",
        contextVersion: version,
        inputJson: { intake, corrections: corrections ?? null },
        outputJson: { ...plan, ruleFixes: planningResult.ruleFixes },
        status: "success",
        attemptNumber: attempt,
      },
    });
    if (planningResult.ruleFixes.length) {
      await logAction({
        runId,
        actor: "planning",
        action: "rules_enforced",
        detail: { fixes: planningResult.ruleFixes },
      });
    }
    emit(runId, "agent", { agent: "planning", status: "done", output: plan, attempt });

    await persistHandoff({
      runId,
      fromAgent: "planning",
      toAgent: "review",
      payload: plan,
      contextVersion: version,
      schema: planningOutputSchema,
    });

    emit(runId, "agent", { agent: "review", status: "running", attempt });
    lastReview = await runReview({
      plan,
      intake,
      transcript: facts.transcript,
      attemptNumber: attempt,
      simulateFailure: failOn === "review" && attempt === 1,
    });
    await prisma.agentOutput.create({
      data: {
        runId,
        agentName: "review",
        contextVersion: version,
        inputJson: { plan, attempt },
        outputJson: lastReview,
        status: "success",
        attemptNumber: attempt,
      },
    });
    emit(runId, "agent", { agent: "review", status: "done", output: lastReview, attempt });

    await persistHandoff({
      runId,
      fromAgent: "review",
      toAgent: lastReview.approved ? "orchestrator" : "planning",
      payload: lastReview,
      contextVersion: version,
      schema: reviewOutputSchema,
    });

    const decision = nextReviewDecision({ approved: lastReview.approved, attemptNumber: attempt });
    await logAction({
      runId,
      actor: "orchestrator",
      action: "review_decision",
      detail: { attempt, decision },
    });
    if (decision === "approved") {
      terminal = "approved";
      break;
    }
    if (decision === "needs_human_review") {
      terminal = "needs_human_review";
      break;
    }
    corrections = lastReview;
  }

  await prisma.agentRun.update({
    where: { runId },
    data: { status: terminal, simulateFailure: null },
  });
  emit(runId, "status", { status: terminal, plan, review: lastReview, contextVersion: version });
}

export async function getRunState(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { runId },
    include: {
      contexts: { orderBy: { version: "asc" } },
      outputs: { orderBy: { createdAt: "asc" } },
      handoffs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return null;
  const logs = await prisma.actionLogEntry.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });
  return { ...run, logs };
}

export async function listSessionRuns(sessionId: string) {
  return prisma.agentRun.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });
}
