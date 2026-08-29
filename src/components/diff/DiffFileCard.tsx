"use client";

import { useState } from "react";
import { DiffFile, DiffLine } from "@/types/diff";

interface DiffFileCardProps {
  file: DiffFile;
  viewMode: "unified" | "split";
  defaultExpanded?: boolean;
}

export function DiffFileCard({
  file,
  viewMode,
  defaultExpanded = true,
}: DiffFileCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const getChangeBadge = () => {
    switch (file.changeType) {
      case "add":
        return (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
            ADDED
          </span>
        );
      case "delete":
        return (
          <span className="rounded bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-400 border border-red-500/20">
            DELETED
          </span>
        );
      case "rename":
        return (
          <span className="rounded bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-400 border border-blue-500/20">
            RENAMED
          </span>
        );
      default:
        return (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400 border border-amber-500/20">
            MODIFIED
          </span>
        );
    }
  };

  return (
    <div
      id={`file-${encodeURIComponent(file.newPath)}`}
      className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d14] text-sm shadow-lg transition-all"
    >
      {/* File Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex cursor-pointer select-none items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-3 hover:bg-white/[0.06] transition"
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="text-white/40 text-xs font-mono">
            {expanded ? "▼" : "▶"}
          </span>
          {getChangeBadge()}
          <span className="truncate font-mono font-medium text-white/90">
            {file.newPath}
          </span>
          {file.changeType === "rename" && (
            <span className="text-xs text-white/40 font-mono">
              (from {file.oldPath})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
          <span className="text-emerald-400 font-medium">+{file.additions}</span>
          <span className="text-red-400 font-medium">-{file.deletions}</span>
          <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/40">
            {file.language}
          </span>
        </div>
      </div>

      {/* File Diff Body */}
      {expanded && (
        <div className="overflow-x-auto font-mono text-[13px] leading-relaxed">
          {file.hunks.length === 0 ? (
            <div className="p-4 text-center text-white/40">
              No content changes in this hunk.
            </div>
          ) : (
            file.hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx} className="border-b border-white/5 last:border-b-0">
                {/* Hunk Header */}
                <div className="bg-violet-950/20 px-4 py-1.5 text-xs text-violet-300/70 border-y border-violet-500/10">
                  {hunk.header}
                </div>

                {viewMode === "unified" ? (
                  <UnifiedHunk lines={hunk.lines} />
                ) : (
                  <SplitHunk lines={hunk.lines} />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UnifiedHunk({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="divide-y divide-white/[0.02]">
      {lines.map((line, idx) => {
        const isAdd = line.type === "add";
        const isDel = line.type === "del";

        return (
          <div
            key={idx}
            className={`flex hover:bg-white/[0.04] transition-colors ${
              isAdd
                ? "bg-emerald-950/25 text-emerald-200"
                : isDel
                  ? "bg-red-950/25 text-red-200 line-through opacity-80"
                  : "text-white/70"
            }`}
          >
            {/* Old line number */}
            <span className="w-12 shrink-0 select-none px-2 py-0.5 text-right text-xs text-white/25 border-r border-white/5">
              {line.oldLineNumber ?? ""}
            </span>
            {/* New line number */}
            <span className="w-12 shrink-0 select-none px-2 py-0.5 text-right text-xs text-white/25 border-r border-white/5">
              {line.newLineNumber ?? ""}
            </span>
            {/* Marker */}
            <span className="w-6 shrink-0 select-none text-center font-bold">
              {isAdd ? "+" : isDel ? "-" : " "}
            </span>
            {/* Code Content */}
            <pre className="flex-1 overflow-x-auto py-0.5 pr-4 whitespace-pre font-mono">
              {line.content || " "}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function SplitHunk({ lines }: { lines: DiffLine[] }) {
  // Pair additions and deletions for side-by-side view
  const pairs: { left?: DiffLine; right?: DiffLine }[] = [];
  const dels: DiffLine[] = [];
  const adds: DiffLine[] = [];

  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let i = 0; i < max; i++) {
      pairs.push({ left: dels[i], right: adds[i] });
    }
    dels.length = 0;
    adds.length = 0;
  };

  for (const line of lines) {
    if (line.type === "context") {
      flush();
      pairs.push({ left: line, right: line });
    } else if (line.type === "del") {
      dels.push(line);
    } else if (line.type === "add") {
      adds.push(line);
    }
  }
  flush();

  return (
    <div className="divide-y divide-white/[0.02]">
      {pairs.map((pair, idx) => (
        <div key={idx} className="grid grid-cols-2 divide-x divide-white/5">
          {/* Left / Old */}
          <div
            className={`flex hover:bg-white/[0.04] transition-colors ${
              pair.left?.type === "del"
                ? "bg-red-950/25 text-red-200"
                : "text-white/70"
            }`}
          >
            <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-xs text-white/25 border-r border-white/5">
              {pair.left?.oldLineNumber ?? ""}
            </span>
            <span className="w-5 shrink-0 select-none text-center text-red-400 font-bold">
              {pair.left?.type === "del" ? "-" : " "}
            </span>
            <pre className="flex-1 overflow-x-auto py-0.5 pr-2 whitespace-pre font-mono">
              {pair.left?.content || " "}
            </pre>
          </div>

          {/* Right / New */}
          <div
            className={`flex hover:bg-white/[0.04] transition-colors ${
              pair.right?.type === "add"
                ? "bg-emerald-950/25 text-emerald-200"
                : "text-white/70"
            }`}
          >
            <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-xs text-white/25 border-r border-white/5">
              {pair.right?.newLineNumber ?? ""}
            </span>
            <span className="w-5 shrink-0 select-none text-center text-emerald-400 font-bold">
              {pair.right?.type === "add" ? "+" : " "}
            </span>
            <pre className="flex-1 overflow-x-auto py-0.5 pr-2 whitespace-pre font-mono">
              {pair.right?.content || " "}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}
