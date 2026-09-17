import { useEffect, useMemo, useState } from "react";
import { api, getSessionId, type AgentRunState } from "../../api/client";
import { useAgentRun } from "../../hooks/useAgentRun";

const AGENTS = ["intake", "planning", "review"] as const;

const STATUS_STYLES: Record<string, string> = {
  running: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
  done: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  error: "bg-rose-100 text-rose-700",
  needs_human_review: "bg-violet-100 text-violet-700",
  pending: "bg-slate-100 text-slate-600",
};

function statusBadge(status: string) {
  return STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
}

const TAG_STYLES: Record<string, string> = {
  fact: "text-emerald-700",
  recommendation: "text-sky-700",
  unresolved_question: "text-amber-700",
};

export function AgentsPage() {
  const [transcript, setTranscript] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [fact, setFact] = useState("Legal has now approved mentioning churn prediction in tooltips.");
  const { run } = useAgentRun(runId);
  const session = getSessionId();

  useEffect(() => {
    void api.transcript().then((r) => setTranscript(r.transcript));
    void api.sessionRuns().then((r) => {
      if (r.runs[0]) setRunId(r.runs[0].runId);
    });
  }, []);

  const plan = useMemo(() => latestPlan(run), [run]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-full bg-indigo-600 text-white px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-indigo-700"
          onClick={async () => {
            const res = await api.startRun();
            setRunId(res.runId);
          }}
        >
          Run
        </button>
        <button
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-100"
          onClick={async () => {
            await api.reset();
            setRunId(null);
          }}
        >
          Reset
        </button>
        {runId && (
          <>
            <button
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-100"
              onClick={() => void api.simulateFailure(runId, "planning")}
            >
              Simulate failure (Planning)
            </button>
            <div className="flex gap-2 items-center">
              <input
                className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 w-80 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                value={fact}
                onChange={(e) => setFact(e.target.value)}
              />
              <button
                className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 transition hover:bg-indigo-100"
                onClick={() => void api.correctFact(runId, "legal.copy", fact)}
              >
                Correct fact & re-run
              </button>
            </div>
          </>
        )}
        <p className="text-xs text-slate-400 font-mono">
          session {session.slice(0, 8)} · live via SSE + 2.5s poll fallback
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6">
        <pre className="text-xs font-mono bg-white border border-slate-200 text-slate-700 rounded-2xl p-4 shadow-sm whitespace-pre-wrap max-h-[420px] overflow-auto">
          {transcript}
        </pre>
        <div>
          <p className="text-sm text-slate-600 mb-3">
            Status:{" "}
            <span
              className={`px-2 py-0.5 rounded-full text-xs uppercase tracking-wide ${statusBadge(run?.status ?? "pending")}`}
            >
              {run?.status ?? "idle"}
            </span>
            {run ? ` · context v${run.contexts.at(-1)?.version ?? 1}` : ""}
          </p>
          <div className="grid md:grid-cols-3 gap-3">
            {AGENTS.map((name) => (
              <AgentCard key={name} name={name} run={run} />
            ))}
          </div>
        </div>
      </div>

      {plan && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <h3 className="text-sm uppercase tracking-widest text-slate-500 mb-3">Approved plan</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Task</th>
                <th>Owner</th>
                <th>Deadline</th>
                <th>Deps</th>
                <th>Tag</th>
              </tr>
            </thead>
            <tbody>
              {plan.tasks.map((t) => (
                <tr key={t.title} className="border-t border-slate-200">
                  <td className="py-2 pr-2 text-slate-800">{t.title}</td>
                  <td className="text-slate-700">{t.owner}</td>
                  <td className="font-mono text-xs text-slate-600">{t.deadline}</td>
                  <td className="text-xs text-slate-500">{t.dependencies.join(", ") || "—"}</td>
                  <td className={`text-xs uppercase ${TAG_STYLES[t.sourceType] ?? "text-slate-600"}`}>
                    {t.sourceType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <h3 className="text-sm uppercase tracking-widest text-slate-500 mb-3">Orchestrator log</h3>
        <ol className="space-y-1 max-h-56 overflow-auto">
          {(run?.logs ?? []).map((l, i) => (
            <li key={i} className="text-xs font-mono text-slate-600">
              <span className="text-indigo-700">{l.actor}</span> · {l.action} · {JSON.stringify(l.detail)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function AgentCard({ name, run }: { name: string; run: AgentRunState | null }) {
  const outputs = (run?.outputs ?? []).filter((o) => o.agentName === name);
  const latest = outputs.at(-1);
  const status = !run ? "pending" : latest ? latest.status : run.status === "running" ? "running" : "pending";
  const handoffs = (run?.handoffs ?? []).filter((h) => h.fromAgent === name || h.toAgent === name);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 space-y-2">
      <div className="flex justify-between items-baseline">
        <h4 className="capitalize text-slate-800">{name}</h4>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${statusBadge(status)}`}>
          {status}
        </span>
      </div>
      <details>
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">Input / output</summary>
        <pre className="text-[11px] font-mono whitespace-pre-wrap text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-2 mt-2 max-h-64 overflow-auto">
          {JSON.stringify({ input: latest?.inputJson, output: latest?.outputJson, attempts: outputs.length }, null, 2)}
        </pre>
      </details>
      {name === "review" && (
        <p className="text-xs text-slate-500">
          Planning↔Review: {handoffs.filter((h) => h.fromAgent === "review" && h.toAgent === "planning").length} correction
          handoff(s)
        </p>
      )}
    </div>
  );
}

function latestPlan(run: AgentRunState | null): {
  tasks: { title: string; owner: string; deadline: string; dependencies: string[]; sourceType: string }[];
} | null {
  const planning = [...(run?.outputs ?? [])].reverse().find((o) => o.agentName === "planning");
  const json = planning?.outputJson as {
    tasks?: { title: string; owner: string; deadline: string; dependencies: string[]; sourceType: string }[];
  } | undefined;
  if (!json?.tasks) return null;
  return { tasks: json.tasks };
}
