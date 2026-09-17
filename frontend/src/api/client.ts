const BASE = import.meta.env.VITE_API_BASE_URL || "";

const SESSION_KEY = "mudita.sessionId";

export function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-session-id": getSessionId(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export type LeadListItem = {
  id: string;
  channel: "EMAIL" | "WHATSAPP" | "INSTAGRAM";
  displayName: string | null;
  externalContactId: string;
  status: string;
  assignedRepId: string | null;
  humanTakeover: boolean;
  lastFallback: string | null;
  lastMessage: string;
  updatedAt: string;
};

export type LeadDetail = {
  id: string;
  channel: string;
  displayName: string | null;
  externalContactId: string;
  status: string;
  assignedRepId: string | null;
  qualificationEvidence: unknown;
  extractedService: string | null;
  extractedBudget: string | null;
  extractedTimeline: string | null;
  lastFallback: string | null;
  humanTakeover: boolean;
  messages: { id: string; direction: string; content: string; createdAt: string }[];
  bookings: { id: string; slotStart: string; slotEnd: string; status: string; idempotencyKey: string }[];
  actionLogs: { id: string; actor: string; action: string; detail: unknown; createdAt: string }[];
};

export type AgentRunState = {
  runId: string;
  sessionId: string;
  status: string;
  transcriptSource: string;
  simulateFailure: string | null;
  contexts: { version: number; sourceFactsJson: unknown; createdAt: string }[];
  outputs: {
    agentName: string;
    contextVersion: number;
    inputJson: unknown;
    outputJson: unknown;
    status: string;
    attemptNumber: number;
    createdAt: string;
  }[];
  handoffs: {
    fromAgent: string;
    toAgent: string;
    payloadJson: unknown;
    validationStatus: string;
    contextVersion: number;
    createdAt: string;
  }[];
  logs: { actor: string; action: string; detail: unknown; createdAt: string }[];
};

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  listLeads: () => request<{ leads: LeadListItem[] }>("/api/leads"),
  getLead: (id: string) => request<{ lead: LeadDetail }>(`/api/leads/${id}`),
  takeover: (id: string) => request<{ lead: LeadDetail }>(`/api/leads/${id}/takeover`, { method: "POST" }),
  simulateInbound: (body: {
    channel: "EMAIL" | "WHATSAPP" | "INSTAGRAM";
    externalContactId: string;
    content: string;
    displayName?: string;
  }) => request<{ lead: LeadDetail }>("/api/leads/simulate-inbound", { method: "POST", body: JSON.stringify(body) }),
  slots: (repId: string) => request<{ slots: { start: string; end: string }[] }>(`/api/calendar/slots?repId=${repId}`),
  book: (body: { leadId: string; slotStart: string; slotEnd: string; repId: string }) =>
    request<unknown>("/api/calendar/book", { method: "POST", body: JSON.stringify(body) }),
  transcript: () => request<{ transcript: string }>("/api/agents/transcript"),
  startRun: () => request<{ runId: string }>("/api/agents/run", { method: "POST" }),
  getRun: (runId: string) => request<{ run: AgentRunState }>(`/api/agents/${runId}`),
  sessionRuns: () => request<{ runs: { runId: string; status: string; createdAt: string }[] }>("/api/agents/session"),
  reset: () => request<{ deleted: number }>("/api/agents/reset", { method: "POST" }),
  correctFact: (runId: string, path: string, value: string) =>
    request<{ ok: boolean }>(`/api/agents/${runId}/correct-fact`, {
      method: "POST",
      body: JSON.stringify({ path, value }),
    }),
  simulateFailure: (runId: string, agentName: string) =>
    request<{ ok: boolean }>(`/api/agents/${runId}/simulate-failure`, {
      method: "POST",
      body: JSON.stringify({ agentName }),
    }),
  streamUrl: (runId: string) => `${BASE}/api/agents/${runId}/stream`,
};
