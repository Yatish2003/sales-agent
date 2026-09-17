import { useCallback, useEffect, useState } from "react";
import { api, type AgentRunState } from "../api/client";

export function useAgentRun(runId: string | null) {
  const [run, setRun] = useState<AgentRunState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runId) return;
    const res = await api.getRun(runId);
    setRun(res.run);
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    const es = new EventSource(api.streamUrl(runId));
    es.addEventListener("snapshot", (ev) => {
      setRun(JSON.parse((ev as MessageEvent).data));
    });
    const reload = () => {
      void refresh().catch((err) => setError(String(err)));
    };
    es.addEventListener("agent", reload);
    es.addEventListener("handoff", reload);
    es.addEventListener("status", reload);
    es.addEventListener("error", reload);
    es.onerror = () => {
      void refresh().catch((err) => setError(String(err)));
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 2500);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [runId, refresh]);

  return { run, error, refresh };
}
