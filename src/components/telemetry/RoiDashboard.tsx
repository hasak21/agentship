"use client";

import { TaskTelemetry } from "@/types/agent";

interface RoiDashboardProps {
  telemetryHistory: TaskTelemetry[];
}

export function RoiDashboard({ telemetryHistory }: RoiDashboardProps) {
  // Aggregate stats
  const totalTasks = telemetryHistory.length;
  const totalTokens = telemetryHistory.reduce((acc, t) => acc + t.totalTokens, 0);
  const totalTimeMs = telemetryHistory.reduce((acc, t) => acc + t.wallTimeMs, 0);
  const totalAdditions = telemetryHistory.reduce((acc, t) => acc + t.linesAdded, 0);
  const totalDeletions = telemetryHistory.reduce((acc, t) => acc + t.linesDeleted, 0);

  const avgAuditScore =
    totalTasks > 0
      ? (
          telemetryHistory
            .filter((t) => t.auditScore !== undefined)
            .reduce((acc, t) => acc + (t.auditScore || 0), 0) /
          (telemetryHistory.filter((t) => t.auditScore !== undefined).length || 1)
        ).toFixed(1)
      : "—";

  // Estimated Cost (Standard blended ~$0.20 / 1M tokens)
  const estimatedCost = ((totalTokens / 1_000_000) * 0.2).toFixed(4);

  return (
    <div className="space-y-6">
      {/* Top Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-700/80 bg-[#121622] p-4.5 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tasks & Execution Time</div>
          <div className="mt-1.5 text-3xl font-extrabold font-mono text-slate-100">
            {totalTasks}
          </div>
          <div className="mt-2 text-xs text-emerald-400 font-medium">
            ✓ {(totalTimeMs / 1000).toFixed(1)}s total wall time
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-[#121622] p-4.5 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Tokens & Est. Cost</div>
          <div className="mt-1.5 text-3xl font-extrabold font-mono text-slate-100">
            {totalTokens.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-indigo-300 font-mono font-medium">
            ≈ ${estimatedCost} USD (Blended)
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-[#121622] p-4.5 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Code Volume Delta</div>
          <div className="mt-1.5 text-3xl font-extrabold font-mono text-slate-100 flex items-center gap-2.5">
            <span className="text-emerald-400">+{totalAdditions}</span>
            <span className="text-rose-400">-{totalDeletions}</span>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            Net changes across files
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-[#121622] p-4.5 shadow-lg">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Avg. Quality Audit Score</div>
          <div className="mt-1.5 text-3xl font-extrabold font-mono text-slate-100">
            {avgAuditScore}
            <span className="text-sm font-normal text-slate-400"> / 100</span>
          </div>
          <div className="mt-2 text-xs text-emerald-400 font-medium">
            🛡️ Cross-model verification
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-2xl border border-slate-700/80 bg-[#121622] overflow-hidden shadow-xl">
        <div className="border-b border-slate-700/80 bg-[#161c28] px-5 py-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            Agent Execution & Audit Log
          </h3>
          <span className="text-xs text-slate-400 font-mono font-medium">
            {telemetryHistory.length} recorded session{telemetryHistory.length === 1 ? "" : "s"}
          </span>
        </div>

        {telemetryHistory.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No telemetry logs recorded in this session yet. Run tasks to observe live performance metrics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-700/80 bg-[#0e121a] text-slate-400 font-mono font-semibold">
                <tr>
                  <th className="py-3 px-4">Task</th>
                  <th className="py-3 px-4">Agents</th>
                  <th className="py-3 px-4">Wall Time</th>
                  <th className="py-3 px-4">Tokens</th>
                  <th className="py-3 px-4">Diff Delta</th>
                  <th className="py-3 px-4">Quality Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-slate-200">
                {telemetryHistory.map((item, idx) => (
                  <tr key={idx} className="hover:bg-[#1a2030] transition-colors">
                    <td className="py-3.5 px-4 font-sans font-semibold text-slate-100 max-w-[220px] truncate">
                      {item.taskTitle}
                    </td>
                    <td className="py-3.5 px-4">{item.agentCount} nodes</td>
                    <td className="py-3.5 px-4">{(item.wallTimeMs / 1000).toFixed(1)}s</td>
                    <td className="py-3.5 px-4">{item.totalTokens.toLocaleString()}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-emerald-400 font-bold">+{item.linesAdded}</span>{" "}
                      <span className="text-rose-400 font-bold">-{item.linesDeleted}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      {item.auditScore ? (
                        <span
                          className={`rounded-md px-2.5 py-0.5 font-bold ${
                            item.auditScore >= 80
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                          }`}
                        >
                          {item.auditScore}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
