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
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl border text-2xl font-bold font-mono ${
                passed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              {overallScore}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">
                  Cross-Model Quality Gate
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    passed
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {passed ? "✓ PASSED" : "✕ BLOCKED"}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                Audited by <span className="font-mono text-violet-300">{auditorModel}</span> ·{" "}
                {(ms / 1000).toFixed(1)}s · {tokens.toLocaleString()} tokens
              </p>
            </div>
          </div>

          {/* Quick Issue Stats */}
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs text-red-300 font-mono">
              {blockerCount} Blockers
            </span>
            <span className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-300 font-mono">
              {warningCount} Warnings
            </span>
            <span className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-xs text-blue-300 font-mono">
              {nitpickCount} Nitpicks
            </span>
          </div>
        </div>

        {/* Summary Description */}
        {summary && (
          <p className="mt-4 border-t border-white/5 pt-4 text-sm leading-relaxed text-white/70">
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
          <h4 className="text-sm font-semibold text-white/90">
            Audit Findings & Recommendations ({issues.length})
          </h4>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 text-xs">
            {["all", "blocker", "warning", "nitpick"].map((sev) => (
              <button
                key={sev}
                onClick={() => setFilterSeverity(sev)}
                className={`rounded-lg px-2.5 py-1 capitalize transition ${
                  filterSeverity === sev
                    ? "bg-violet-600 text-white font-medium shadow"
                    : "bg-white/5 text-white/50 hover:text-white"
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-white/40">
            No issues found in this category.
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <div
              key={issue.id}
              className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d14] p-4 text-sm shadow-md transition hover:border-white/20"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={issue.severity} />
                  <span className="font-semibold text-white/90">{issue.title}</span>
                </div>
                {issue.file && (
                  <span className="font-mono text-xs text-violet-300/80 bg-violet-950/30 px-2 py-0.5 rounded border border-violet-500/20">
                    {issue.file}
                    {issue.line ? `:${issue.line}` : ""}
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs leading-relaxed text-white/70">
                {issue.description}
              </p>

              {issue.snippet && (
                <pre className="mt-2.5 overflow-x-auto rounded-lg bg-black/50 p-2.5 font-mono text-xs text-red-300/80 border border-white/5">
                  {issue.snippet}
                </pre>
              )}

              {issue.suggestion && (
                <div className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-950/10 p-3 text-xs text-emerald-200">
                  <div className="font-semibold text-emerald-300 mb-1">
                    💡 Suggested Fix:
                  </div>
                  <p>{issue.suggestion}</p>
                </div>
              )}

              {issue.fixPatch && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-white/40 mb-1 font-mono">
                    <span>Proposed Patch</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyPatch(issue.id, issue.fixPatch!)}
                        className="text-violet-400 hover:text-violet-300 transition"
                      >
                        {copiedId === issue.id ? "✓ Copied!" : "📋 Copy Patch"}
                      </button>
                      {onApplyFix && (
                        <button
                          onClick={() => onApplyFix(issue)}
                          className="text-emerald-400 hover:text-emerald-300 font-semibold transition"
                        >
                          ⚡ Apply Fix
                        </button>
                      )}
                    </div>
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-black/60 p-2.5 font-mono text-xs text-emerald-300/90 border border-emerald-500/20">
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
    return "from-red-500 to-orange-400";
  };

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-white/80">{label}</span>
        <span className="font-mono font-bold text-white tabular-nums">
          {score.toFixed(1)}
          <span className="text-[10px] font-normal text-white/40">/10</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${getBarColor(score)}`}
          style={{ width: `${(score / 10) * 100}%` }}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-tight text-white/45" title={comment}>
        {comment}
      </p>
    </div>
  );
}
