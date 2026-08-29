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

  // Estimated Cost (Gemini Flash ~$0.10 / 1M tokens)
  const estimatedCost = ((totalTokens / 1_000_000) * 0.1).toFixed(4);

  return (
    <div className="space-y-6">
      {/* Top Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs text-white/40">Tasks & Execution Time</div>
          <div className="mt-1 text-2xl font-bold font-mono text-white">
            {totalTasks}
          </div>
          <div className="mt-2 text-[11px] text-emerald-400">
            ✓ {(totalTimeMs / 1000).toFixed(1)}s total execution time
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs text-white/40">Total Tokens & Est. Cost</div>
          <div className="mt-1 text-2xl font-bold font-mono text-white">
            {totalTokens.toLocaleString()}
          </div>
          <div className="mt-2 text-[11px] text-violet-300 font-mono">
            ≈ ${estimatedCost} USD (Flash tier)
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs text-white/40">Code Volume Delta</div>
          <div className="mt-1 text-2xl font-bold font-mono text-white flex items-center gap-2">
            <span className="text-emerald-400">+{totalAdditions}</span>
            <span className="text-red-400">-{totalDeletions}</span>
          </div>
          <div className="mt-2 text-[11px] text-white/40">
            Net changes across files
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs text-white/40">Avg. Quality Audit Score</div>
          <div className="mt-1 text-2xl font-bold font-mono text-white">
            {avgAuditScore}
            <span className="text-xs font-normal text-white/40"> / 100</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-400">
            🛡️ Cross-model verification
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-2xl border border-white/10 bg-[#0d0d14] overflow-hidden shadow-lg">
        <div className="border-b border-white/5 bg-white/[0.02] px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/90">
            Agent Execution & Audit Log
          </h3>
          <span className="text-xs text-white/40 font-mono">
            {telemetryHistory.length} recorded session{telemetryHistory.length === 1 ? "" : "s"}
          </span>
        </div>

        {telemetryHistory.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/40">
            No telemetry logs recorded in this session yet. Run tasks to observe live performance metrics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/5 bg-white/[0.01] text-white/40 font-mono">
                <tr>
                  <th className="py-2.5 px-4 font-normal">Task</th>
                  <th className="py-2.5 px-4 font-normal">Agents</th>
                  <th className="py-2.5 px-4 font-normal">Wall Time</th>
                  <th className="py-2.5 px-4 font-normal">Tokens</th>
                  <th className="py-2.5 px-4 font-normal">Diff Delta</th>
                  <th className="py-2.5 px-4 font-normal">Quality Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-white/70">
                {telemetryHistory.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02] transition">
                    <td className="py-3 px-4 font-sans font-medium text-white/90 max-w-[200px] truncate">
                      {item.taskTitle}
                    </td>
                    <td className="py-3 px-4">{item.agentCount} nodes</td>
                    <td className="py-3 px-4">{(item.wallTimeMs / 1000).toFixed(1)}s</td>
                    <td className="py-3 px-4">{item.totalTokens.toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <span className="text-emerald-400">+{item.linesAdded}</span>{" "}
                      <span className="text-red-400">-{item.linesDeleted}</span>
                    </td>
                    <td className="py-3 px-4">
                      {item.auditScore ? (
                        <span
                          className={`rounded px-2 py-0.5 font-bold ${
                            item.auditScore >= 80
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {item.auditScore}
                        </span>
                      ) : (
                        <span className="text-white/30">—</span>
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
