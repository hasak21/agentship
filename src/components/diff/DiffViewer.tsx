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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <span className="text-3xl mb-3">🔍</span>
        <h3 className="text-base font-medium text-white/80">No Diff Available</h3>
        <p className="mt-1 text-sm text-white/40 max-w-sm">
          Run an Agent task or paste a Git Unified Diff to inspect file changes and trigger multi-model quality audit.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur">
        {/* Left: Summary Stats & File Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="rounded-md bg-white/5 px-2.5 py-1 text-white/70">
              📁 {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300 font-semibold">
              +{totalAdditions}
            </span>
            <span className="rounded-md bg-red-500/10 px-2 py-1 text-red-300 font-semibold">
              -{totalDeletions}
            </span>
          </div>

          {/* Quick file jump */}
          {fileCount > 1 && (
            <select
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              aria-label="Filter file"
              className="rounded-lg border border-white/10 bg-[#12121c] px-2.5 py-1 text-xs text-white/80 outline-none focus:border-violet-400"
            >
              <option value="all">All Files ({fileCount})</option>
              {files.map((f, i) => (
                <option key={i} value={f.newPath}>
                  {f.newPath} (+{f.additions} -{f.deletions})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right: View Mode Toggle & Audit Action Button */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
            <button
              onClick={() => setViewMode("unified")}
              className={`rounded-md px-2.5 py-1 transition ${
                viewMode === "unified"
                  ? "bg-violet-600 text-white font-medium shadow"
                  : "text-white/50 hover:text-white"
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`rounded-md px-2.5 py-1 transition ${
                viewMode === "split"
                  ? "bg-violet-600 text-white font-medium shadow"
                  : "text-white/50 hover:text-white"
              }`}
            >
              Split
            </button>
          </div>

          {onAuditClick && (
            <button
              onClick={onAuditClick}
              disabled={isAuditing}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg shadow-violet-900/30 transition hover:opacity-90 disabled:opacity-50"
            >
              {isAuditing ? (
                <>
                  <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white" />
                  <span>Auditing Diff…</span>
                </>
              ) : (
                <>
                  <span>🛡️</span>
                  <span>Cross-Audit Diff</span>
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
