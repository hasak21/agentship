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
          <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
            ADDED
          </span>
        );
      case "delete":
        return (
          <span className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">
            DELETED
          </span>
        );
      case "rename":
        return (
          <span className="rounded border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-300">
            RENAMED
          </span>
        );
      default:
        return (
          <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
            MODIFIED
          </span>
        );
    }
  };

  return (
    <div
      id={`file-${encodeURIComponent(file.newPath)}`}
      className="overflow-hidden rounded-xl border border-slate-700/80 bg-[#121622] text-sm shadow-xl transition-all"
    >
      {/* File Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex cursor-pointer select-none items-center justify-between border-b border-slate-700/80 bg-[#161c2b] px-4 py-3 hover:bg-[#1c2436] transition"
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="text-slate-400 text-xs font-mono">
            {expanded ? "▼" : "▶"}
          </span>
          {getChangeBadge()}
          <span className="truncate font-mono font-semibold text-slate-100">
            {file.newPath}
          </span>
          {file.changeType === "rename" && (
            <span className="text-xs text-slate-400 font-mono">
              (from {file.oldPath})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
          <span className="text-emerald-400 font-bold">+{file.additions}</span>
          <span className="text-rose-400 font-bold">-{file.deletions}</span>
          <span className="rounded border border-slate-700 bg-[#1a2030] px-2 py-0.5 text-[11px] text-slate-300 font-medium">
            {file.language}
          </span>
        </div>
      </div>

      {/* File Diff Body */}
      {expanded && (
        <div className="overflow-x-auto font-mono text-[13px] leading-relaxed bg-[#0b0e17]">
          {file.hunks.length === 0 ? (
            <div className="p-4 text-center text-slate-400">
              No content changes in this hunk.
            </div>
          ) : (
            file.hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx} className="border-b border-slate-800 last:border-b-0">
                {/* Hunk Header */}
                <div className="bg-[#182030] px-4 py-1.5 text-xs text-indigo-300 font-medium border-y border-indigo-500/20">
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
    <div className="divide-y divide-slate-800/60">
      {lines.map((line, idx) => {
        const isAdd = line.type === "add";
        const isDel = line.type === "del";

        return (
          <div
            key={idx}
            className={`flex hover:bg-slate-800/40 transition-colors ${
              isAdd
                ? "bg-emerald-950/45 text-emerald-200 border-l-2 border-emerald-500"
                : isDel
                  ? "bg-rose-950/45 text-rose-200 border-l-2 border-rose-500 opacity-90"
                  : "text-slate-200"
            }`}
          >
            {/* Old line number */}
            <span className="w-12 shrink-0 select-none px-2 py-0.5 text-right text-xs text-slate-500 bg-[#0e121a] border-r border-slate-800 font-mono">
              {line.oldLineNumber ?? ""}
            </span>
            {/* New line number */}
            <span className="w-12 shrink-0 select-none px-2 py-0.5 text-right text-xs text-slate-500 bg-[#0e121a] border-r border-slate-800 font-mono">
              {line.newLineNumber ?? ""}
            </span>
            {/* Marker */}
            <span
              className={`w-6 shrink-0 select-none text-center font-bold ${
                isAdd ? "text-emerald-400" : isDel ? "text-rose-400" : "text-slate-600"
              }`}
            >
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
    <div className="divide-y divide-slate-800/60">
      {pairs.map((pair, idx) => (
        <div key={idx} className="grid grid-cols-2 divide-x divide-slate-800">
          {/* Left / Old */}
          <div
            className={`flex hover:bg-slate-800/40 transition-colors ${
              pair.left?.type === "del"
                ? "bg-rose-950/45 text-rose-200 border-l-2 border-rose-500"
                : "text-slate-200"
            }`}
          >
            <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-xs text-slate-500 bg-[#0e121a] border-r border-slate-800 font-mono">
              {pair.left?.oldLineNumber ?? ""}
            </span>
            <span className="w-5 shrink-0 select-none text-center text-rose-400 font-bold">
              {pair.left?.type === "del" ? "-" : " "}
            </span>
            <pre className="flex-1 overflow-x-auto py-0.5 pr-2 whitespace-pre font-mono">
              {pair.left?.content || " "}
            </pre>
          </div>

          {/* Right / New */}
          <div
            className={`flex hover:bg-slate-800/40 transition-colors ${
              pair.right?.type === "add"
                ? "bg-emerald-950/45 text-emerald-200 border-l-2 border-emerald-500"
                : "text-slate-200"
            }`}
          >
            <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-xs text-slate-500 bg-[#0e121a] border-r border-slate-800 font-mono">
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
