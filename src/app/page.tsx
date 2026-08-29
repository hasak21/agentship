"use client";

import { useState } from "react";
import { parseGitDiff } from "@/lib/diff-parser";
import { ParsedDiff } from "@/types/diff";
import { AuditReport } from "@/types/audit";
import { TaskTelemetry } from "@/types/agent";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { AuditReportCard } from "@/components/audit/AuditReportCard";
import { RoiDashboard } from "@/components/telemetry/RoiDashboard";

// ---------- Types ----------
type Source = { title: string; uri: string };
type NodeState = {
  id: string;
  role: string;
  title: string;
  subtitle: string;
  state: "running" | "done";
  result?: string;
  sources?: Source[];
  ms?: number;
  tokens?: number;
  model?: string;
  failed?: boolean;
  confidence?: "high" | "medium" | "low";
  retried?: boolean;
};
type TrackStats = { calls: number; tokens: number; ms: number };
type Track = {
  id: string;
  pattern: string;
  label: string;
  nodes: NodeState[];
  final?: { answer: string; sources: Source[]; stats?: TrackStats };
};
type Rubric = { correctness: number; completeness: number; clarity: number };
type Verdict = {
  scores: { A: Rubric; B: Rubric };
  totals: { A: number; B: number };
  winner: "A" | "B" | "tie";
  rationale: string;
  tokens: number;
};

type Pattern =
  | "auto"
  | "orchestrator"
  | "debate"
  | "router"
  | "consistency"
  | "single";

const PATTERNS: { id: Pattern; label: string; blurb: string }[] = [
  { id: "auto", label: "Auto", blurb: "A meta-agent picks the pattern" },
  { id: "orchestrator", label: "Orchestrator", blurb: "Plan → parallel workers → synthesize" },
  { id: "debate", label: "Debate", blurb: "Openings → rebuttals → a judge rules" },
  { id: "router", label: "Router", blurb: "Classify → route to a specialist" },
  { id: "consistency", label: "Consistency", blurb: "Sample 4× independently → vote" },
  { id: "single", label: "Single", blurb: "One model, one call (baseline)" },
];

const EXAMPLES = [
  "Write a TypeScript rate-limiter middleware with tests and audit it",
  "Refactor a user auth hook in React to support OAuth and refresh tokens",
  "Plan a scalable multi-agent microservice architecture",
  "Implement a thread-safe LRU cache with expiration in Python",
];

const SAMPLE_DIFF = `diff --git a/src/middleware/rate-limiter.ts b/src/middleware/rate-limiter.ts
new file mode 100644
index 0000000..8a91b2c
--- /dev/null
+++ b/src/middleware/rate-limiter.ts
@@ -0,0 +1,42 @@
+import { NextRequest, NextResponse } from "next/server";
+
+interface RateLimitConfig {
+  limit: number;
+  windowMs: number;
+}
+
+const ipRequestMap = new Map<string, { count: number; resetAt: number }>();
+
+export function rateLimiter(config: RateLimitConfig = { limit: 60, windowMs: 60000 }) {
+  return async function middleware(req: NextRequest) {
+    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
+    const now = Date.now();
+    
+    const record = ipRequestMap.get(ip);
+    
+    if (!record || now > record.resetAt) {
+      ipRequestMap.set(ip, { count: 1, resetAt: now + config.windowMs });
+      return null;
+    }
+    
+    if (record.count >= config.limit) {
+      return NextResponse.json(
+        { error: "Too many requests. Please try again later." },
+        { status: 429 }
+      );
+    }
+    
+    record.count++;
+    return null;
+  };
+}
diff --git a/tests/rate-limiter.test.ts b/tests/rate-limiter.test.ts
new file mode 100644
index 0000000..9c42d1f
--- /dev/null
+++ b/tests/rate-limiter.test.ts
@@ -0,0 +1,25 @@
+import { describe, it, expect } from "vitest";
+import { rateLimiter } from "../src/middleware/rate-limiter";
+
+describe("Rate Limiter Middleware", () => {
+  it("should allow requests under the limit", async () => {
+    const limiter = rateLimiter({ limit: 5, windowMs: 1000 });
+    const mockReq = { headers: { get: () => "192.168.1.1" } } as any;
+    
+    const res = await limiter(mockReq);
+    expect(res).toBeNull();
+  });
+
+  it("should block requests exceeding the limit", async () => {
+    const limiter = rateLimiter({ limit: 2, windowMs: 1000 });
+    const mockReq = { headers: { get: () => "192.168.1.2" } } as any;
+    
+    await limiter(mockReq);
+    await limiter(mockReq);
+    const blocked = await limiter(mockReq);
+    
+    expect(blocked?.status).toBe(429);
+  });
+});`;

const ROLE_ICON: Record<string, string> = {
  agent: "🤖",
  planner: "🧭",
  worker: "🔎",
  synthesizer: "✍️",
  debater: "💬",
  judge: "⚖️",
  router: "🚦",
  specialist: "🛠️",
  critic: "🕵️",
  reviser: "♻️",
  auditor: "🛡️",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"orchestration" | "diff" | "audit" | "telemetry">("orchestration");
  const [task, setTask] = useState("");
  const [pattern, setPattern] = useState<Pattern>("orchestrator");
  const [critic, setCritic] = useState(false);
  const [web, setWeb] = useState(false);
  const [compare, setCompare] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [judging, setJudging] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictError, setVerdictError] = useState("");

  // Diff & Audit state
  const [rawDiff, setRawDiff] = useState<string>(SAMPLE_DIFF);
  const [parsedDiff, setParsedDiff] = useState<ParsedDiff>(() => parseGitDiff(SAMPLE_DIFF));
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditError, setAuditError] = useState("");

  // Telemetry state
  const [telemetryHistory, setTelemetryHistory] = useState<TaskTelemetry[]>([]);

  const started = tracks.length > 0 || running;
  const compareEnabled = pattern !== "single";

  const handleDiffChange = (newDiff: string) => {
    setRawDiff(newDiff);
    setParsedDiff(parseGitDiff(newDiff));
  };

  async function triggerAudit(customDiff?: string) {
    const diffToAudit = (customDiff ?? rawDiff).trim();
    if (!diffToAudit || isAuditing) return;

    setIsAuditing(true);
    setAuditError("");
    setActiveTab("audit");

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diff: diffToAudit,
          context: task || "Coding Agent Generated Pull Request",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to audit diff.");
      }

      const report: AuditReport = await res.json();
      setAuditReport(report);

      // Record to telemetry
      setTelemetryHistory((prev) => [
        {
          taskId: report.id,
          taskTitle: task || "Git Diff Audit Session",
          agentCount: 1,
          totalTokens: report.tokens,
          wallTimeMs: report.ms,
          linesAdded: parsedDiff.totalAdditions,
          linesDeleted: parsedDiff.totalDeletions,
          auditScore: report.overallScore,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setIsAuditing(false);
    }
  }

  async function run(input?: string) {
    const question = (input ?? task).trim();
    if (!question || running) return;
    if (input) setTask(input);

    setRunning(true);
    setError("");
    setTracks([]);
    setJudging(false);
    setVerdict(null);
    setVerdictError("");
    setActiveTab("orchestration");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          pattern,
          critic,
          web,
          compare: compare && compareEnabled,
        }),
      });
      if (!res.ok || !res.body) throw new Error("server");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()), question);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(
    evt: {
      type: string;
      track?: string;
      pattern?: string;
      label?: string;
      id?: string;
      role?: string;
      title?: string;
      subtitle?: string;
      result?: string;
      sources?: Source[];
      answer?: string;
      message?: string;
      ms?: number;
      tokens?: number;
      model?: string;
      failed?: boolean;
      confidence?: "high" | "medium" | "low";
      reason?: string;
      stats?: TrackStats;
      scores?: { A: Rubric; B: Rubric };
      totals?: { A: number; B: number };
      winner?: "A" | "B" | "tie";
      rationale?: string;
    },
    taskQuestion: string
  ) {
    if (evt.type === "error") {
      setError(evt.message ?? "Something went wrong.");
      return;
    }
    if (evt.type === "judging") {
      setJudging(true);
      return;
    }
    if (evt.type === "verdict") {
      setJudging(false);
      setVerdict({
        scores: evt.scores!,
        totals: evt.totals!,
        winner: evt.winner!,
        rationale: evt.rationale ?? "",
        tokens: evt.tokens ?? 0,
      });
      return;
    }
    if (evt.type === "verdict_error") {
      setJudging(false);
      setVerdictError(evt.message ?? "The judge could not score this run.");
      return;
    }
    const trackId = evt.track ?? "A";
    setTracks((prev) => {
      const next = prev.map((t) => ({ ...t, nodes: [...t.nodes] }));
      const track = next.find((t) => t.id === trackId);
      if (!track && evt.type === "track") {
        next.push({
          id: trackId,
          pattern: evt.pattern ?? "",
          label: evt.label ?? "",
          nodes: [],
        });
        return next;
      }
      if (!track) return prev;

      switch (evt.type) {
        case "node":
          track.nodes.push({
            id: evt.id ?? "",
            role: evt.role ?? "agent",
            title: evt.title ?? "",
            subtitle: evt.subtitle ?? "",
            state: "running",
          });
          break;
        case "node_done": {
          const n = track.nodes.find((x) => x.id === evt.id);
          if (n) {
            n.state = "done";
            n.result = evt.result;
            n.sources = evt.sources;
            n.ms = evt.ms;
            n.tokens = evt.tokens;
            n.model = evt.model;
            n.failed = evt.failed;
            n.confidence = evt.confidence;
          }
          break;
        }
        case "node_retry": {
          const n = track.nodes.find((x) => x.id === evt.id);
          if (n) n.retried = true;
          break;
        }
        case "track_label":
          track.label = evt.label ?? track.label;
          break;
        case "final": {
          track.final = {
            answer: evt.answer ?? "",
            sources: evt.sources ?? [],
            stats: evt.stats,
          };

          // Record telemetry if final
          if (evt.stats && trackId === "A") {
            setTelemetryHistory((h) => [
              {
                taskId: `task-${Date.now()}`,
                taskTitle: taskQuestion,
                agentCount: track.nodes.length,
                totalTokens: evt.stats?.tokens || 0,
                wallTimeMs: evt.stats?.ms || 0,
                linesAdded: 0,
                linesDeleted: 0,
                timestamp: Date.now(),
              },
              ...h,
            ]);
          }

          // Check if answer contains a git diff block
          const diffMatch = evt.answer?.match(/```(?:diff|patch)?\n([\s\S]*?diff --git[\s\S]*?)```/);
          if (diffMatch && diffMatch[1]) {
            handleDiffChange(diffMatch[1]);
          }
          break;
        }
      }
      return next;
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 sm:py-12">
      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-glow absolute left-1/2 top-[-15%] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-600/25 via-fuchsia-500/15 to-blue-500/25 blur-[140px]" />
        <div className="animate-glow absolute bottom-[-10%] left-[8%] h-[380px] w-[380px] rounded-full bg-blue-600/15 blur-[140px]" />
        <div className="animate-glow absolute right-[6%] top-[30%] h-[300px] w-[300px] rounded-full bg-fuchsia-600/10 blur-[140px]" />
      </div>

      <div className="mx-auto w-full max-w-6xl">
        {/* Header Branding */}
        <div className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3.5 py-1 text-xs text-violet-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            AgentShip 2.0 · Mission Control & Multi-Model Audit Gate
          </div>
          <h1 className="bg-gradient-to-b from-white via-white/90 to-white/40 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl font-mono">
            ✦ AgentShip 2.0
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-white/50">
            Visual workspace and multi-model quality & security audit gate for CLI Coding Agents (Claude Code, DeepSeek Harness, OpenCode, Pi).
          </p>
        </div>

        {/* Global Workspace Navigation Tabs */}
        <div className="mx-auto mt-6 flex max-w-2xl justify-center">
          <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur shadow-xl">
            <button
              onClick={() => setActiveTab("orchestration")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                activeTab === "orchestration"
                  ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <span>🧭</span>
              <span>Agent Topologies</span>
            </button>
            <button
              onClick={() => setActiveTab("diff")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                activeTab === "diff"
                  ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <span>🔍</span>
              <span>Visual Diff Review</span>
              {parsedDiff.fileCount > 0 && (
                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                  {parsedDiff.fileCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("audit")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                activeTab === "audit"
                  ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <span>🛡️</span>
              <span>Cross-Audit Gate</span>
              {auditReport && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${auditReport.passed ? 'bg-emerald-500/30 text-emerald-300' : 'bg-red-500/30 text-red-300'}`}>
                  {auditReport.overallScore}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium transition ${
                activeTab === "telemetry"
                  ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <span>📊</span>
              <span>Telemetry ROI</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Agent Topologies & Multi-Agent Orchestration */}
        {activeTab === "orchestration" && (
          <div className="mt-8">
            {/* Pattern selector */}
            <div className="mx-auto max-w-4xl">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {PATTERNS.map((p) => {
                  const active = pattern === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPattern(p.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-violet-400/50 bg-violet-500/15"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <div className="text-sm font-medium text-white/90">
                        {p.label}
                      </div>
                      <div className="mt-0.5 text-xs text-white/40">{p.blurb}</div>
                    </button>
                  );
                })}
              </div>

              {/* Toggles */}
              <div className="mt-3 flex flex-wrap gap-2">
                <Toggle
                  label="🕵️ Critic pass"
                  on={critic}
                  onClick={() => setCritic((v) => !v)}
                />
                <Toggle
                  label="🌐 Web search"
                  on={web}
                  onClick={() => setWeb((v) => !v)}
                />
                <Toggle
                  label="⚖️ Compare vs single"
                  on={compare && compareEnabled}
                  disabled={!compareEnabled}
                  onClick={() => setCompare((v) => !v)}
                />
              </div>

              {/* Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run();
                }}
                className="mt-4"
              >
                <div className="relative rounded-2xl border border-white/10 bg-white/5 p-2 shadow-2xl shadow-black/40 backdrop-blur transition-colors focus-within:border-violet-400/50">
                  <textarea
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        run();
                      }
                    }}
                    placeholder="Give the agents a coding or research task… (Enter to dispatch, Shift+Enter for new line)"
                    rows={2}
                    className="w-full resize-none bg-transparent px-4 py-3 pr-16 text-sm outline-none placeholder:text-white/30"
                  />
                  <button
                    type="submit"
                    disabled={running || !task.trim()}
                    aria-label="Run agents"
                    className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-tr from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/40 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running ? (
                      <span className="spinner h-4 w-4 rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <span className="text-lg leading-none">↑</span>
                    )}
                  </button>
                </div>
              </form>

              {/* Examples */}
              {!started && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((x) => (
                    <button
                      key={x}
                      onClick={() => run(x)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 transition hover:border-white/20 hover:text-white"
                    >
                      {x}
                    </button>
                  ))}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* Tracks */}
              {tracks.length > 0 && (
                <div
                  className={`mt-10 grid gap-5 ${
                    tracks.length > 1 ? "lg:grid-cols-2" : "max-w-4xl mx-auto"
                  }`}
                >
                  {tracks.map((t) => (
                    <TrackView
                      key={t.id}
                      track={t}
                      onViewDiff={() => setActiveTab("diff")}
                    />
                  ))}
                </div>
              )}

              {/* Judge */}
              {judging && (
                <div className="animate-fade-up mt-6 flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/5 px-5 py-4">
                  <span className="spinner h-5 w-5 rounded-full border-2 border-white/20 border-t-amber-400" />
                  <div>
                    <div className="text-sm font-medium text-white/90">
                      ⚖️ Judge is scoring both answers…
                    </div>
                    <div className="text-xs text-white/40">
                      Blind pairwise evaluation, judged twice with positions swapped
                    </div>
                  </div>
                </div>
              )}
              {verdictError && (
                <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  ⚖️ {verdictError}
                </div>
              )}
              {verdict && (
                <VerdictCard
                  verdict={verdict}
                  labelA={tracks.find((t) => t.id === "A")?.label ?? "A"}
                  labelB={tracks.find((t) => t.id === "B")?.label ?? "B"}
                />
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Visual Diff Review */}
        {activeTab === "diff" && (
          <div className="mt-8 space-y-6 max-w-5xl mx-auto">
            {/* Diff Input / Edit area */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white/80">
                  📥 Ingest Git Unified Diff (from CLI Agent or Git):
                </span>
                <button
                  onClick={() => handleDiffChange(SAMPLE_DIFF)}
                  className="text-xs text-violet-400 hover:text-violet-300 transition"
                >
                  Load Sample PR Diff
                </button>
              </div>
              <textarea
                value={rawDiff}
                onChange={(e) => handleDiffChange(e.target.value)}
                placeholder="Paste unified git diff here (diff --git a/... b/...)..."
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white/80 outline-none focus:border-violet-400 resize-y"
              />
            </div>

            {/* Interactive Visual Diff Viewer */}
            <DiffViewer
              parsedDiff={parsedDiff}
              onAuditClick={() => triggerAudit()}
              isAuditing={isAuditing}
            />
          </div>
        )}

        {/* Tab 3: Cross-Audit Gate */}
        {activeTab === "audit" && (
          <div className="mt-8 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Multi-Model Code Quality & Security Audit Gate
                </h3>
                <p className="text-xs text-white/50">
                  Cross-examine agent generated code with independent Auditor LLMs to eliminate blind spots.
                </p>
              </div>
              <button
                onClick={() => triggerAudit()}
                disabled={isAuditing || !rawDiff.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-violet-900/30 transition hover:opacity-90 disabled:opacity-50"
              >
                {isAuditing ? (
                  <>
                    <span className="spinner h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white" />
                    <span>Auditing Code…</span>
                  </>
                ) : (
                  <>
                    <span>🛡️</span>
                    <span>Re-Audit Diff</span>
                  </>
                )}
              </button>
            </div>

            {auditError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                {auditError}
              </div>
            )}

            {isAuditing && !auditReport && (
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-12 text-center">
                <span className="spinner inline-block h-8 w-8 rounded-full border-2 border-white/20 border-t-violet-400 mb-3" />
                <h4 className="text-base font-medium text-white/90">
                  Auditor is scanning diff across 4 dimensions…
                </h4>
                <p className="mt-1 text-xs text-white/40">
                  Checking Security vulnerabilities, Logic bugs, Edge cases, and Test coverage.
                </p>
              </div>
            )}

            {auditReport && <AuditReportCard report={auditReport} />}
          </div>
        )}

        {/* Tab 4: Telemetry & ROI Dashboard */}
        {activeTab === "telemetry" && (
          <div className="mt-8 max-w-5xl mx-auto">
            <RoiDashboard telemetryHistory={telemetryHistory} />
          </div>
        )}
      </div>
    </main>
  );
}

// ---------- Sub Components ----------

function Toggle({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        disabled
          ? "cursor-not-allowed border-white/5 text-white/20"
          : on
            ? "border-violet-400/50 bg-violet-500/20 text-white"
            : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-white/45">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-white/70">
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function VerdictCard({
  verdict,
  labelA,
  labelB,
}: {
  verdict: Verdict;
  labelA: string;
  labelB: string;
}) {
  const winnerLabel =
    verdict.winner === "tie"
      ? "It's a tie"
      : `Winner: ${verdict.winner === "A" ? labelA : labelB}`;
  const sides: { id: "A" | "B"; label: string }[] = [
    { id: "A", label: labelA },
    { id: "B", label: labelB },
  ];
  return (
    <div className="animate-fade-up mx-auto mt-6 max-w-4xl rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-500/10 to-white/[0.02] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg">⚖️</span>
        <span className="font-medium text-white/90">Judge&apos;s verdict</span>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
            verdict.winner === "tie"
              ? "bg-white/10 text-white/70"
              : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {verdict.winner === "tie" ? "🤝" : "🏆"} {winnerLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {sides.map((s) => {
          const r = verdict.scores[s.id];
          const won = verdict.winner === s.id;
          return (
            <div
              key={s.id}
              className={`rounded-xl border p-4 ${
                won
                  ? "border-emerald-400/30 bg-emerald-500/5"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-white/85">
                  {s.label}
                </span>
                <span className="text-xl font-semibold tabular-nums text-white">
                  {verdict.totals[s.id].toFixed(1)}
                  <span className="text-xs font-normal text-white/40">/30</span>
                </span>
              </div>
              <div className="space-y-1.5">
                <ScoreBar label="Correctness" value={r.correctness} />
                <ScoreBar label="Completeness" value={r.completeness} />
                <ScoreBar label="Clarity" value={r.clarity} />
              </div>
            </div>
          );
        })}
      </div>

      {verdict.rationale && (
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          {verdict.rationale}
        </p>
      )}
      <p className="mt-2 text-xs text-white/30">
        Blind pairwise evaluation · judged twice with positions swapped ·{" "}
        {verdict.tokens.toLocaleString()} judge tokens
      </p>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tabular-nums text-white/60">
      {label} {value}
    </span>
  );
}

function StatusDot({
  state,
  failed,
}: {
  state: "running" | "done";
  failed?: boolean;
}) {
  if (state === "running")
    return (
      <span className="spinner inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-violet-400" />
    );
  if (failed)
    return (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-red-500/20 text-[10px] text-red-400">
        ✕
      </span>
    );
  return (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-400">
      ✓
    </span>
  );
}

const CONF_STYLE: Record<string, string> = {
  high: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  low: "border-red-400/30 bg-red-500/10 text-red-300",
};

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${CONF_STYLE[level]}`}
      title="Worker's self-reported confidence — the synthesizer weighs sub-answers by this"
    >
      {level}
    </span>
  );
}

function TrackView({
  track,
  onViewDiff,
}: {
  track: Track;
  onViewDiff?: () => void;
}) {
  const running = track.nodes.some((n) => n.state === "running") || !track.final;
  return (
    <div className="animate-fade-up rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      {/* Track header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-lg bg-white/5 px-2 py-1 text-xs font-medium text-white/70">
          {track.label}
        </span>
        {running && (
          <span className="text-xs text-white/35">running…</span>
        )}
      </div>

      {/* Nodes */}
      <div className="space-y-2.5">
        {track.nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
      </div>

      {/* Final answer */}
      {track.final && (
        <div className="animate-fade-up mt-4 rounded-xl border border-violet-400/25 bg-gradient-to-b from-violet-500/10 to-white/[0.02] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-white/90">
            <span>✅</span> Final Output
            {track.final.stats && (
              <span className="ml-auto flex flex-wrap gap-1.5">
                <StatChip label="⏱" value={fmtMs(track.final.stats.ms)} />
                <StatChip
                  label="🤖"
                  value={`${track.final.stats.calls} call${track.final.stats.calls === 1 ? "" : "s"}`}
                />
                <StatChip
                  label="🔢"
                  value={`${track.final.stats.tokens.toLocaleString()} tok`}
                />
              </span>
            )}
          </div>
          <FormattedText text={track.final.answer} />
          <SourceList sources={track.final.sources} />

          {onViewDiff && (
            <div className="mt-3 pt-3 border-t border-white/5 flex justify-end">
              <button
                onClick={onViewDiff}
                className="text-xs text-violet-400 hover:text-violet-300 font-mono flex items-center gap-1"
              >
                <span>🔍 Inspect Visual Diff →</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: NodeState }) {
  const [open, setOpen] = useState(false);
  const icon = ROLE_ICON[node.role] ?? "•";
  const hasResult = !!node.result;
  return (
    <div
      className={`animate-fade-up rounded-xl border p-3.5 ${
        node.failed
          ? "border-red-400/25 bg-red-500/[0.06]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-base">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white/85">
              {node.title}
            </span>
            {node.confidence && <ConfidenceBadge level={node.confidence} />}
            {node.retried && (
              <span
                className="text-[10px] text-amber-400/70"
                title="This agent failed once and was automatically re-dispatched"
              >
                ↻ retried
              </span>
            )}
          </div>
          <div className="truncate text-xs text-white/40">{node.subtitle}</div>
        </div>
        {node.state === "done" && node.ms !== undefined && (
          <span
            className="whitespace-nowrap text-[11px] tabular-nums text-white/30"
            title={node.model ? `model: ${node.model}` : undefined}
          >
            {fmtMs(node.ms)}
            {node.tokens ? ` · ${node.tokens.toLocaleString()} tok` : ""}
            {node.model ? ` · ${node.model.replace("gemini-", "")}` : ""}
          </span>
        )}
        <StatusDot state={node.state} failed={node.failed} />
      </div>

      {node.state === "running" && !hasResult && (
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
          <div className="pulse-bar h-2.5 w-full rounded bg-white/10" />
          <div className="pulse-bar h-2.5 w-2/3 rounded bg-white/10" />
        </div>
      )}

      {hasResult && (
        <div className="mt-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-white/40 transition hover:text-white/70"
          >
            {open ? "▾ hide details" : "▸ show details"}
          </button>
          {open && (
            <div className="mt-2 max-h-56 overflow-auto border-t border-white/5 pt-3 text-sm text-white/70">
              <FormattedText text={node.result ?? ""} compact />
              <SourceList sources={node.sources} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources?: Source[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3 border-t border-white/5 pt-2">
      <div className="mb-1 text-xs uppercase tracking-wide text-white/35">
        Sources
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[220px] truncate rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-blue-300 transition hover:border-white/20 hover:text-blue-200"
            title={s.title}
          >
            {i + 1}. {s.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function inline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong key={key} className="font-semibold text-white">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code
          key={key}
          className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-violet-200"
        >
          {p.slice(1, -1)}
        </code>
      );
    return <span key={key}>{p}</span>;
  });
}

function FormattedText({ text, compact }: { text: string; compact?: boolean }) {
  const lines = text.split("\n");
  return (
    <div
      className={`${compact ? "space-y-1" : "space-y-2"} leading-relaxed text-white/85`}
    >
      {lines.map((line, i) => {
        const key = `l-${i}`;
        if (/^#{1,6}\s/.test(line)) {
          const content = line.replace(/^#{1,6}\s/, "");
          return (
            <h3 key={key} className="mt-3 font-semibold text-white">
              {inline(content, key)}
            </h3>
          );
        }
        if (/^\s*[-*]\s/.test(line)) {
          const content = line.replace(/^\s*[-*]\s/, "");
          return (
            <div key={key} className="flex gap-2">
              <span className="mt-0.5 text-violet-400">•</span>
              <span>{inline(content, key)}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={key} className="h-1" />;
        return <p key={key}>{inline(line, key)}</p>;
      })}
    </div>
  );
}
