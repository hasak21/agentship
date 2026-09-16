"use client";

import { useState } from "react";
import { parseGitDiff } from "@/lib/diff-parser";
import { ParsedDiff, AuditReport, TaskTelemetry } from "@/types";
import { DiffViewer, AuditReportCard, RoiDashboard } from "@/components";
import { UNIVERSAL_MODEL_PRESETS } from "@/lib/llm";

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

const PATTERNS: { id: Pattern; label: string; icon: string; blurb: string }[] = [
  { id: "auto", label: "Auto", icon: "🧠", blurb: "A meta-agent dynamically selects the optimal topology" },
  { id: "orchestrator", label: "Orchestrator", icon: "🧭", blurb: "Plan → parallel worker fan-out → synthesis" },
  { id: "debate", label: "Debate", icon: "💬", blurb: "Openings → counter-rebuttals → judicial ruling" },
  { id: "router", label: "Router", icon: "🚦", blurb: "Classify intent → route to domain specialist" },
  { id: "consistency", label: "Consistency", icon: "🎲", blurb: "Sample 4× independently → majority voting" },
  { id: "single", label: "Single", icon: "⚡", blurb: "One model, direct single call (baseline)" },
];

const EXAMPLES = [
  "Write a TypeScript rate-limiter middleware with tests and audit it",
  "Refactor a user auth hook in React to support OAuth and refresh tokens",
  "Plan a scalable multi-agent microservice architecture with resilience",
  "Implement a thread-safe LRU cache with TTL expiration in Python",
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
+diff --git a/tests/rate-limiter.test.ts b/tests/rate-limiter.test.ts
+new file mode 100644
+index 0000000..9c42d1f
+--- /dev/null
++++ b/tests/rate-limiter.test.ts
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
  const [activeTab, setActiveTab] = useState<"orchestration" | "diff" | "audit" | "telemetry">("diff");
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

  // Universal Model & MCP Integration state
  const [selectedModelId, setSelectedModelId] = useState<string>("deepseek-v3");
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

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
  const activeModelPreset =
    UNIVERSAL_MODEL_PRESETS.find((p) => p.id === selectedModelId) ??
    UNIVERSAL_MODEL_PRESETS[0];

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
          model: activeModelPreset.defaultModel,
          provider: activeModelPreset.provider,
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
          model: activeModelPreset.defaultModel,
          provider: activeModelPreset.provider,
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
      setError("Something went wrong. Please check your network and provider settings.");
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
      let track = next.find((t) => t.id === trackId);
      if (!track) {
        track = {
          id: trackId,
          pattern: evt.pattern ?? "orchestrator",
          label: evt.label ?? (trackId === "A" ? "Pattern Run" : "Comparator"),
          nodes: [],
        };
        next.push(track);
      }
      switch (evt.type) {
        case "node_start": {
          const exists = track.nodes.some((x) => x.id === evt.id);
          if (!exists) {
            track.nodes.push({
              id: evt.id!,
              role: evt.role ?? "agent",
              title: evt.title ?? "Step",
              subtitle: evt.subtitle ?? "",
              state: "running",
            });
          }
          break;
        }
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
    <main className="relative min-h-screen bg-[#0a0d14] text-slate-100 px-4 py-8 sm:py-10">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-glow absolute left-1/2 top-[-10%] h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-600/15 via-violet-600/10 to-sky-600/15 blur-[120px]" />
        <div className="animate-glow absolute bottom-[-10%] left-[5%] h-[350px] w-[350px] rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>

      <div className="mx-auto w-full max-w-6xl">
        {/* Header Branding & Status Bar */}
        <header className="flex flex-col items-center justify-center text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-[#121622] px-4 py-1.5 text-xs font-semibold text-indigo-300 shadow-md">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            AgentShip Verify · Independent Evidence, Not Agent Claims
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-5xl font-mono">
            ✦ AgentShip Verify
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-300 leading-relaxed">
            Evidence-based preflight for agent-written code. Run the checks yourself, inspect the change, and decide whether it is ready to ship.
          </p>
        </header>

        {/* Global Navigation & Engine Toolbar */}
        <div className="mx-auto mt-7 flex max-w-4xl flex-wrap items-center justify-between gap-3">
          {/* Segment Tabs */}
          <nav className="inline-flex rounded-2xl border border-slate-700/80 bg-[#121622] p-1.5 shadow-xl backdrop-blur">
            <button
              onClick={() => setActiveTab("orchestration")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "orchestration"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <span>🧭</span>
              <span>Model Lab</span>
            </button>
            <button
              onClick={() => setActiveTab("diff")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "diff"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <span>🔍</span>
              <span>Preflight Diff</span>
              {parsedDiff.fileCount > 0 && (
                <span className="rounded-full bg-indigo-950 px-2 py-0.5 text-[11px] font-mono border border-indigo-400/40 text-indigo-300">
                  {parsedDiff.fileCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("audit")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "audit"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <span>🛡️</span>
              <span>Evidence Review</span>
              {auditReport && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-mono font-bold ${auditReport.passed ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/25 text-rose-300 border border-rose-500/40'}`}>
                  {auditReport.passed ? "PASS" : "BLOCK"}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                activeTab === "telemetry"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <span>📊</span>
              <span>Run History</span>
            </button>
          </nav>

          {/* Model Selector & MCP Launch Button */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-[#121622] px-3.5 py-2 shadow-md">
              <span className="text-xs font-semibold text-slate-400">Engine:</span>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                aria-label="Select LLM Engine"
                className="bg-transparent text-xs font-bold text-indigo-300 outline-none cursor-pointer font-mono"
              >
                {UNIVERSAL_MODEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#121622] text-slate-100">
                    {p.name} ({p.badge})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowMcpModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-3.5 py-2 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/25 active:scale-[0.98] shadow-md"
            >
              <span>🔌</span>
              <span>CLI & MCP</span>
            </button>
          </div>
        </div>

        {/* Experimental model-topology lab; verification remains the primary workflow. */}
        {activeTab === "orchestration" && (
          <section className="mt-8">
            <div className="mx-auto max-w-4xl space-y-4">
              {/* Pattern selector */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {PATTERNS.map((p) => {
                  const active = pattern === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPattern(p.id)}
                      className={`rounded-2xl border p-3.5 text-left transition-all shadow-md ${
                        active
                          ? "border-indigo-500 bg-[#171f33] ring-1 ring-indigo-500/50"
                          : "border-slate-700/80 bg-[#121622] hover:border-slate-600 hover:bg-[#161c28]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{p.icon}</span>
                        <span className="text-sm font-bold text-slate-100">
                          {p.label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs leading-snug text-slate-300 font-medium">
                        {p.blurb}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap gap-2.5 pt-1">
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

              {/* Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run();
                }}
              >
                <div className="relative rounded-2xl border border-slate-700/80 bg-[#121622] p-2.5 shadow-2xl transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
                  <textarea
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        run();
                      }
                    }}
                    placeholder="Experimental: compare model strategies on a task… (Enter to dispatch)"
                    rows={2}
                    className="w-full resize-none bg-transparent px-4 py-3 pr-16 text-sm text-slate-100 font-medium outline-none placeholder:text-slate-400"
                  />
                  <button
                    type="submit"
                    disabled={running || !task.trim()}
                    aria-label="Run agents"
                    className="absolute bottom-3.5 right-3.5 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-600/30 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running ? (
                      <span className="spinner h-4 w-4 rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <span className="text-xl font-bold leading-none">↑</span>
                    )}
                  </button>
                </div>
              </form>

              {/* Examples */}
              {!started && (
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {EXAMPLES.map((x) => (
                    <button
                      key={x}
                      onClick={() => run(x)}
                      className="rounded-full border border-slate-700/80 bg-[#161c28] px-3.5 py-1 text-xs text-slate-300 font-medium transition hover:border-indigo-500 hover:text-white"
                    >
                      {x}
                    </button>
                  ))}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 font-medium shadow-md">
                  {error}
                </div>
              )}

              {/* Tracks */}
              {tracks.length > 0 && (
                <div
                  className={`pt-6 grid gap-6 ${
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

              {/* Judge Scoring */}
              {judging && (
                <div className="animate-fade-up flex items-center gap-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 shadow-lg">
                  <span className="spinner h-5 w-5 rounded-full border-2 border-amber-300/30 border-t-amber-400" />
                  <div>
                    <div className="text-sm font-bold text-amber-200">
                      ⚖️ Blind Judge is scoring both multi-agent runs…
                    </div>
                    <div className="text-xs text-amber-300/80 font-medium">
                      Pairwise evaluation across Correctness, Completeness, and Clarity.
                    </div>
                  </div>
                </div>
              )}
              {verdictError && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
                  ⚖️ {verdictError}
                </div>
              )}
              {verdict && (
                <VerdictCard
                  verdict={verdict}
                  labelA={tracks.find((t) => t.id === "A")?.label ?? "Pattern Run"}
                  labelB={tracks.find((t) => t.id === "B")?.label ?? "Comparator"}
                />
              )}
            </div>
          </section>
        )}

        {/* Tab 2: Visual Diff Review */}
        {activeTab === "diff" && (
          <section className="mt-8 space-y-6 max-w-5xl mx-auto">
            {/* Diff Input / Edit area */}
            <div className="rounded-2xl border border-slate-700/80 bg-[#121622] p-4.5 shadow-xl">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-slate-200">
                  📥 Ingest Git Unified Diff (from CLI Agent or Git):
                </span>
                <button
                  onClick={() => handleDiffChange(SAMPLE_DIFF)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
                >
                  Load Sample PR Diff
                </button>
              </div>
              <textarea
                value={rawDiff}
                onChange={(e) => handleDiffChange(e.target.value)}
                placeholder="Paste unified git diff here (diff --git a/... b/...)..."
                rows={3}
                className="w-full rounded-xl border border-slate-700 bg-[#0b0e17] p-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-y"
              />
            </div>

            {/* Interactive Visual Diff Viewer */}
            <DiffViewer
              parsedDiff={parsedDiff}
              onAuditClick={() => triggerAudit()}
              isAuditing={isAuditing}
            />
          </section>
        )}

        {/* Tab 3: Cross-Audit Gate */}
        {activeTab === "audit" && (
          <section className="mt-8 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  Multi-Model Code Quality & Security Audit Gate
                </h3>
                <p className="text-xs text-slate-300">
                  Cross-examine agent generated code with independent Auditor LLMs to eliminate blind spots.
                </p>
              </div>
              <button
                onClick={() => triggerAudit()}
                disabled={isAuditing || !rawDiff.trim()}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
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
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-sm text-rose-200 font-medium">
                {auditError}
              </div>
            )}

            {isAuditing && !auditReport && (
              <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-12 text-center shadow-xl">
                <span className="spinner inline-block h-8 w-8 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 mb-3" />
                <h4 className="text-base font-bold text-slate-100">
                  Auditor is scanning diff across 4 dimensions…
                </h4>
                <p className="mt-1.5 text-xs text-slate-300">
                  Checking Security vulnerabilities, Logic bugs, Edge cases, and Test coverage.
                </p>
              </div>
            )}

            {auditReport && <AuditReportCard report={auditReport} />}
          </section>
        )}

        {/* Tab 4: Telemetry & ROI Dashboard */}
        {activeTab === "telemetry" && (
          <section className="mt-8 max-w-5xl mx-auto">
            <RoiDashboard telemetryHistory={telemetryHistory} />
          </section>
        )}

        {/* MCP Ecosystem Integration Modal */}
        {showMcpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
            <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/80 bg-[#121622] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-700/80 pb-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-lg border border-indigo-500/30">
                    🔌
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      AgentShip Verify Integration Hub
                    </h3>
                    <p className="text-xs text-slate-300">
                      Connect your favorite terminal coding agents and IDEs.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMcpModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Endpoint Banner */}
              <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-300 font-mono font-bold">
                    MCP Server Endpoint: http://localhost:3000/api/mcp
                  </span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText("http://localhost:3000/api/mcp");
                    setCopiedSnippet("mcp-url");
                    setTimeout(() => setCopiedSnippet(null), 2000);
                  }}
                  className="text-xs font-bold text-emerald-300 hover:underline"
                >
                  {copiedSnippet === "mcp-url" ? "✓ Copied" : "Copy URL"}
                </button>
              </div>

              {/* Instructions list */}
              <div className="mt-5 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {/* 1. Claude Code */}
                <div className="rounded-xl border border-slate-700/80 bg-[#161c28] p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-100">
                      1. Claude Code (CLI)
                    </h4>
                    <button
                      onClick={() => {
                        const snippet = `claude mcp add agentship http://localhost:3000/api/mcp`;
                        navigator.clipboard.writeText(snippet);
                        setCopiedSnippet("claude");
                        setTimeout(() => setCopiedSnippet(null), 2000);
                      }}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                    >
                      {copiedSnippet === "claude" ? "✓ Copied" : "Copy Command"}
                    </button>
                  </div>
                  <pre className="mt-2 rounded-lg bg-[#0b0e17] p-3 text-xs font-mono text-indigo-300 border border-slate-800 overflow-x-auto">
                    claude mcp add agentship http://localhost:3000/api/mcp
                  </pre>
                </div>

                {/* 2. Cursor / Windsurf */}
                <div className="rounded-xl border border-slate-700/80 bg-[#161c28] p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-100">
                      2. Cursor / Windsurf (.cursor/mcp.json)
                    </h4>
                    <button
                      onClick={() => {
                        const snippet = JSON.stringify(
                          {
                            mcpServers: {
                              agentship: {
                                url: "http://localhost:3000/api/mcp",
                              },
                            },
                          },
                          null,
                          2
                        );
                        navigator.clipboard.writeText(snippet);
                        setCopiedSnippet("cursor");
                        setTimeout(() => setCopiedSnippet(null), 2000);
                      }}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                    >
                      {copiedSnippet === "cursor" ? "✓ Copied" : "Copy JSON"}
                    </button>
                  </div>
                  <pre className="mt-2 rounded-lg bg-[#0b0e17] p-3 text-xs font-mono text-indigo-300 border border-slate-800 overflow-x-auto">
{`{
  "mcpServers": {
    "agentship": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}`}
                  </pre>
                </div>

                {/* 3. Pi Coding Agent */}
                <div className="rounded-xl border border-slate-700/80 bg-[#161c28] p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-100">
                      3. Pi Coding Agent (pi-coding-agent)
                    </h4>
                    <button
                      onClick={() => {
                        const snippet = `pi -e ./extensions/pi-agentship.ts`;
                        navigator.clipboard.writeText(snippet);
                        setCopiedSnippet("pi");
                        setTimeout(() => setCopiedSnippet(null), 2000);
                      }}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                    >
                      {copiedSnippet === "pi" ? "✓ Copied" : "Copy Command"}
                    </button>
                  </div>
                  <pre className="mt-2 rounded-lg bg-[#0b0e17] p-3 text-xs font-mono text-indigo-300 border border-slate-800 overflow-x-auto">
                    pi -e ./extensions/pi-agentship.ts
                  </pre>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowMcpModal(false)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100 hover:bg-slate-700 transition"
                >
                  Close
                </button>
              </div>
            </div>
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
      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${
        disabled
          ? "cursor-not-allowed border-slate-800 bg-[#0e121a] text-slate-600"
          : on
            ? "border-indigo-500/80 bg-indigo-500/20 text-indigo-200 shadow-sm"
            : "border-slate-700/80 bg-[#121622] text-slate-300 hover:border-slate-600 hover:text-white"
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
      <span className="w-24 font-medium text-slate-300">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400"
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono font-bold tabular-nums text-slate-100">
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
    <div className="animate-fade-up mx-auto mt-6 max-w-4xl rounded-2xl border border-amber-500/40 bg-[#151a27] p-5 shadow-2xl">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-700/80 pb-3">
        <span className="text-xl">⚖️</span>
        <span className="font-bold text-slate-100">Judge&apos;s Pairwise Verdict</span>
        <span
          className={`ml-auto rounded-full px-3.5 py-1 text-xs font-bold ${
            verdict.winner === "tie"
              ? "bg-slate-700 text-slate-200"
              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
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
              className={`rounded-xl border p-4 shadow-sm ${
                won
                  ? "border-emerald-500/40 bg-emerald-950/20"
                  : "border-slate-700/80 bg-[#121622]"
              }`}
            >
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-bold text-slate-100">
                  {s.label}
                </span>
                <span className="text-xl font-extrabold font-mono tabular-nums text-slate-100">
                  {verdict.totals[s.id].toFixed(1)}
                  <span className="text-xs font-normal text-slate-400">/30</span>
                </span>
              </div>
              <div className="space-y-2">
                <ScoreBar label="Correctness" value={r.correctness} />
                <ScoreBar label="Completeness" value={r.completeness} />
                <ScoreBar label="Clarity" value={r.clarity} />
              </div>
            </div>
          );
        })}
      </div>

      {verdict.rationale && (
        <p className="mt-4 text-sm leading-relaxed text-slate-200 border-t border-slate-700/80 pt-3">
          {verdict.rationale}
        </p>
      )}
      <p className="mt-2 text-xs font-mono text-slate-400">
        Blind pairwise evaluation · judged twice with positions swapped ·{" "}
        {verdict.tokens.toLocaleString()} judge tokens
      </p>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-slate-700 bg-[#1a2030] px-2.5 py-0.5 text-xs font-mono font-medium tabular-nums text-slate-200">
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
      <span className="spinner inline-block h-4 w-4 rounded-full border-2 border-indigo-400/30 border-t-indigo-400" />
    );
  if (failed)
    return (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-rose-500/25 text-[10px] font-bold text-rose-300">
        ✕
      </span>
    );
  return (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500/25 text-[10px] font-bold text-emerald-300">
      ✓
    </span>
  );
}

const CONF_STYLE: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  low: "border-rose-500/40 bg-rose-500/15 text-rose-300",
};

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CONF_STYLE[level]}`}
      title="Worker's self-reported confidence"
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
    <div className="animate-fade-up rounded-2xl border border-slate-700/80 bg-[#121622] p-5 shadow-xl">
      {/* Track header */}
      <div className="mb-3.5 flex items-center justify-between border-b border-slate-700/80 pb-3">
        <span className="rounded-lg border border-slate-700 bg-[#161c28] px-3 py-1 text-xs font-bold text-slate-100">
          {track.label}
        </span>
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-indigo-300 font-semibold">
            <span className="spinner h-3 w-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400" />
            Executing DAG…
          </span>
        ) : (
          <span className="text-xs text-emerald-400 font-bold">✓ Complete</span>
        )}
      </div>

      {/* Nodes */}
      <div className="space-y-3">
        {track.nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
      </div>

      {/* Final answer */}
      {track.final && (
        <div className="animate-fade-up mt-5 rounded-xl border border-indigo-500/30 bg-[#161c28] p-4.5 shadow-lg">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-100">
            <span className="text-emerald-400">✅</span> Final Output
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
            <div className="mt-3.5 pt-3 border-t border-slate-700/80 flex justify-end">
              <button
                onClick={onViewDiff}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-mono font-bold flex items-center gap-1"
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
      className={`animate-fade-up rounded-xl border p-3.5 transition-all shadow-sm ${
        node.failed
          ? "border-rose-500/30 bg-rose-950/20"
          : "border-slate-700/80 bg-[#161c28]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a2030] text-base border border-slate-700">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">
              {node.title}
            </span>
            {node.confidence && <ConfidenceBadge level={node.confidence} />}
            {node.retried && (
              <span
                className="text-[10px] text-amber-300 font-bold bg-amber-950/30 px-1.5 py-0.5 rounded border border-amber-500/30"
                title="This agent failed once and was automatically re-dispatched"
              >
                ↻ retried
              </span>
            )}
          </div>
          <div className="truncate text-xs text-slate-300 font-medium">{node.subtitle}</div>
        </div>
        {node.state === "done" && node.ms !== undefined && (
          <span
            className="whitespace-nowrap text-xs font-mono tabular-nums text-slate-400"
            title={node.model ? `model: ${node.model}` : undefined}
          >
            {fmtMs(node.ms)}
            {node.tokens ? ` · ${node.tokens.toLocaleString()} tok` : ""}
          </span>
        )}
        <StatusDot state={node.state} failed={node.failed} />
      </div>

      {node.state === "running" && !hasResult && (
        <div className="mt-3 space-y-2 border-t border-slate-700/60 pt-3">
          <div className="pulse-bar h-2.5 w-full rounded bg-slate-700/80" />
          <div className="pulse-bar h-2.5 w-2/3 rounded bg-slate-700/80" />
        </div>
      )}

      {hasResult && (
        <div className="mt-2.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
          >
            {open ? "▾ Hide reasoning trace" : "▸ Show reasoning trace"}
          </button>
          {open && (
            <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-[#0b0e17] p-3 border border-slate-800 text-xs text-slate-200 font-mono">
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
    <div className="mt-3 border-t border-slate-700/80 pt-2.5">
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
        Sources
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[220px] truncate rounded-md border border-slate-700 bg-[#121622] px-2.5 py-1 text-xs text-sky-300 font-medium transition hover:border-sky-400 hover:text-sky-200"
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
        <strong key={key} className="font-bold text-slate-100">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code
          key={key}
          className="rounded border border-slate-700 bg-[#1a2030] px-1.5 py-0.5 font-mono text-[0.9em] text-indigo-300"
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
      className={`${compact ? "space-y-1.5" : "space-y-2.5"} leading-relaxed text-slate-200`}
    >
      {lines.map((line, i) => {
        const key = `l-${i}`;
        if (/^#{1,6}\s/.test(line)) {
          const content = line.replace(/^#{1,6}\s/, "");
          return (
            <h3 key={key} className="mt-3 font-bold text-slate-100 text-base">
              {inline(content, key)}
            </h3>
          );
        }
        if (/^\s*[-*]\s/.test(line)) {
          const content = line.replace(/^\s*[-*]\s/, "");
          return (
            <div key={key} className="flex gap-2 text-sm">
              <span className="mt-0.5 text-indigo-400 font-bold">•</span>
              <span>{inline(content, key)}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={key} className="h-1" />;
        return <p key={key} className="text-sm">{inline(line, key)}</p>;
      })}
    </div>
  );
}
