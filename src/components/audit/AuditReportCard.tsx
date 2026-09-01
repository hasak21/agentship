"use client";

import { useState } from "react";
import { AuditReport, AuditIssue } from "@/types/audit";
import { SeverityBadge } from "./SeverityBadge";

interface AuditReportCardProps {
  report: AuditReport;
  onApplyFix?: (issue: AuditIssue) => void;
}

export function AuditReportCard({ report, onApplyFix }: AuditReportCardProps) {
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { overallScore, passed, summary, scores, issues, auditorModel, ms, tokens } =
    report;

  const filteredIssues =
    filterSeverity === "all"
      ? issues
      : issues.filter((i) => i.severity === filterSeverity);

  const blockerCount = issues.filter((i) => i.severity === "blocker").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const nitpickCount = issues.filter((i) => i.severity === "nitpick").length;

  const handleCopyPatch = (issueId: string, patch: string) => {
    navigator.clipboard.writeText(patch);
    setCopiedId(issueId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-[#121622] p-6 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl font-extrabold font-mono shadow-inner ${
                passed
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-emerald-950"
                  : "border-rose-500/50 bg-rose-500/15 text-rose-300 shadow-rose-950"
              }`}
            >
              {overallScore}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold text-slate-100">
                  Cross-Model Quality & Security Gate
                </h3>
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-bold tracking-wide ${
                    passed
                      ? "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                      : "border border-rose-500/40 bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {passed ? "✓ PASSED" : "✕ BLOCKED"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Audited by <span className="font-mono font-semibold text-indigo-300">{auditorModel}</span> ·{" "}
                {(ms / 1000).toFixed(1)}s · {tokens.toLocaleString()} tokens
              </p>
            </div>
          </div>

          {/* Quick Issue Stats */}
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 font-bold font-mono">
              {blockerCount} Blockers
            </span>
            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 font-bold font-mono">
              {warningCount} Warnings
            </span>
            <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300 font-bold font-mono">
              {nitpickCount} Nitpicks
            </span>
          </div>
        </div>

        {/* Summary Description */}
        {summary && (
          <p className="mt-4 border-t border-slate-700/80 pt-4 text-sm leading-relaxed text-slate-200">
            {summary}
          </p>
        )}

        {/* 4 Dimension Score Bars */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ScoreTile
            label="🛡️ Security"
            score={scores.security.score}
            comment={scores.security.comment}
          />
          <ScoreTile
            label="⚙️ Correctness"
            score={scores.correctness.score}
            comment={scores.correctness.comment}
          />
          <ScoreTile
            label="🧪 Test Coverage"
            score={scores.testCoverage.score}
            comment={scores.testCoverage.comment}
          />
          <ScoreTile
            label="🧹 Maintainability"
            score={scores.maintainability.score}
            comment={scores.maintainability.comment}
          />
        </div>
      </div>

      {/* Issues List Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-100">
            Audit Findings & Recommendations ({issues.length})
          </h4>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {["all", "blocker", "warning", "nitpick"].map((sev) => (
              <button
                key={sev}
                onClick={() => setFilterSeverity(sev)}
                className={`rounded-lg px-3 py-1 capitalize transition ${
                  filterSeverity === sev
                    ? "bg-indigo-600 text-white font-semibold shadow-md"
                    : "border border-slate-700/80 bg-[#161c28] text-slate-300 hover:text-white"
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <div className="rounded-xl border border-slate-700/80 bg-[#121622] p-8 text-center text-sm text-slate-400">
            No issues found in this category.
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className="overflow-hidden rounded-xl border border-slate-700/80 bg-[#121622] p-4 text-sm shadow-lg transition hover:border-slate-600"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <SeverityBadge severity={issue.severity} />
                  <span className="font-bold text-slate-100">{issue.title}</span>
                </div>
                {issue.file && (
                  <span className="font-mono text-xs text-indigo-300 bg-[#1a2030] px-2.5 py-0.5 rounded-md border border-indigo-500/30">
                    {issue.file}
                    {issue.line ? `:${issue.line}` : ""}
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                {issue.description}
              </p>

              {issue.snippet && (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0b0e17] p-3 font-mono text-xs text-rose-300 border border-slate-800">
                  {issue.snippet}
                </pre>
              )}

              {issue.suggestion && (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/25 p-3 text-xs text-emerald-200">
                  <div className="font-bold text-emerald-300 mb-1">
                    💡 Suggested Fix:
                  </div>
                  <p className="leading-relaxed">{issue.suggestion}</p>
                </div>
              )}

              {issue.fixPatch && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-mono">
                    <span className="font-medium text-slate-300">Proposed Patch</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCopyPatch(issue.id, issue.fixPatch!)}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold transition"
                      >
                        {copiedId === issue.id ? "✓ Copied!" : "📋 Copy Patch"}
                      </button>
                      {onApplyFix && (
                        <button
                          onClick={() => onApplyFix(issue)}
                          className="text-emerald-400 hover:text-emerald-300 font-bold transition"
                        >
                          ⚡ Apply Fix
                        </button>
                      )}
                    </div>
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-[#0b0e17] p-3 font-mono text-xs text-emerald-300 border border-emerald-500/30">
                    {issue.fixPatch}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ScoreTile({
  label,
  score,
  comment,
}: {
  label: string;
  score: number;
  comment: string;
}) {
  const getBarColor = (val: number) => {
    if (val >= 8.5) return "from-emerald-500 to-teal-400";
    if (val >= 7.0) return "from-amber-500 to-yellow-400";
    return "from-rose-500 to-orange-400";
  };

  return (
    <div className="rounded-xl border border-slate-700/80 bg-[#161c28] p-3.5 shadow-sm">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-200">{label}</span>
        <span className="font-mono font-bold text-slate-100 tabular-nums">
          {score.toFixed(1)}
          <span className="text-[10px] font-normal text-slate-400">/10</span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${getBarColor(score)}`}
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-300" title={comment}>
        {comment}
      </p>
    </div>
  );
}
