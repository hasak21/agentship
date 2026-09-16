"use client";

import { useState } from "react";
import { ParsedDiff } from "@/types/diff";
import { DiffFileCard } from "./DiffFileCard";

interface DiffViewerProps {
  parsedDiff: ParsedDiff;
  onAuditClick?: () => void;
  isAuditing?: boolean;
}

export function DiffViewer({
  parsedDiff,
  onAuditClick,
  isAuditing,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [selectedFile, setSelectedFile] = useState<string>("all");

  const { files, totalAdditions, totalDeletions, fileCount } = parsedDiff;

  const filteredFiles =
    selectedFile === "all"
      ? files
      : files.filter((f) => f.newPath === selectedFile);

  if (fileCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-[#121622]/90 p-12 text-center shadow-xl">
        <span className="text-4xl mb-3">🔍</span>
        <h3 className="text-base font-semibold text-slate-100">No Diff Available</h3>
        <p className="mt-1.5 text-sm text-slate-300 max-w-md leading-relaxed">
          Run an Agent task or paste a Git Unified Diff in the box above to inspect file changes and trigger a multi-model quality & security audit.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#121622] p-3.5 shadow-lg backdrop-blur">
        {/* Left: Summary Stats & File Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="rounded-md border border-slate-700 bg-[#1a2030] px-2.5 py-1 text-slate-200 font-medium">
              📁 {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-md border border-emerald-600/30 bg-emerald-500/15 px-2.5 py-1 text-emerald-300 font-bold">
              +{totalAdditions}
            </span>
            <span className="rounded-md border border-rose-600/30 bg-rose-500/15 px-2.5 py-1 text-rose-300 font-bold">
              -{totalDeletions}
            </span>
          </div>

          {/* Quick file jump */}
          {fileCount > 1 && (
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              aria-label="Filter file"
              className="rounded-lg border border-slate-700 bg-[#1a2030] px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 cursor-pointer font-mono"
            >
              <option value="all">All Changed Files ({fileCount})</option>
              {files.map((f, i) => (
                <option key={i} value={f.newPath}>
                  {f.newPath} (+{f.additions} -{f.deletions})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right: View Mode Toggle & Audit Action Button */}
        <div className="flex items-center gap-2.5">
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#1a2030] p-0.5 text-xs font-medium">
            <button
              onClick={() => setViewMode("unified")}
              className={`rounded-md px-3 py-1.5 transition ${
                viewMode === "unified"
                  ? "bg-indigo-600 text-white font-semibold shadow-md"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Unified View
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`rounded-md px-3 py-1.5 transition ${
                viewMode === "split"
                  ? "bg-indigo-600 text-white font-semibold shadow-md"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Side-by-Side Split
            </button>
          </div>

          {onAuditClick && (
            <button
              onClick={onAuditClick}
              disabled={isAuditing}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {isAuditing ? (
                <>
                  <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white" />
                  <span>Auditing Diff…</span>
                </>
              ) : (
                <>
                  <span>🛡️</span>
                  <span>Request Evidence Review</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* File Cards List */}
      <div className="space-y-4">
        {filteredFiles.map((file, idx) => (
          <DiffFileCard
            key={idx}
            file={file}
            viewMode={viewMode}
            defaultExpanded={true}
          />
        ))}
      </div>
    </div>
  );
}
