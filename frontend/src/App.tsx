import type { ReactNode } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { SalesAssistantPage } from "./routes/SalesAssistant";
import { AgentsPage } from "./routes/Agents";
import { getSessionId } from "./api/client";

function Layout({ children }: { children: ReactNode }) {
  const session = getSessionId().slice(0, 8);
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-indigo-600">Mudita assignments</p>
          <h1 className="text-lg font-semibold text-slate-900">Northlight Analytics</h1>
        </div>
        <nav className="flex gap-2 text-sm">
          <NavLink
            to="/sales-assistant"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-full transition ${
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            Sales assistant
          </NavLink>
          <NavLink
            to="/agents"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-full transition ${
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            Agents
          </NavLink>
        </nav>
        <p className="font-mono text-xs text-slate-400">session {session}</p>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/sales-assistant" element={<SalesAssistantPage />} />
        <Route path="/sales-assistant/:leadId" element={<SalesAssistantPage />} />
        <Route path="/agents" element={<AgentsPage />} />
      </Routes>
    </Layout>
  );
}
