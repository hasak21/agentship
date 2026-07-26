"use client";

import { useState } from "react";

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
};
type TrackStats = { calls: number; tokens: number; ms: number };
type Track = {
  id: string;
  pattern: string;
  label: string;
  nodes: NodeState[];
  final?: { answer: string; sources: Source[]; stats?: TrackStats };
};

type Pattern = "orchestrator" | "debate" | "router" | "single";

const PATTERNS: { id: Pattern; label: string; blurb: string }[] = [
  { id: "orchestrator", label: "Orchestrator", blurb: "Plan → parallel workers → synthesize" },
  { id: "debate", label: "Debate", blurb: "A panel argues → a judge decides" },
  { id: "router", label: "Router", blurb: "Classify → route to a specialist" },
  { id: "single", label: "Single", blurb: "One model, one call (baseline)" },
];

const EXAMPLES = [
  "Plan a 3-day trip to Kyoto on a budget",
  "Should a startup use microservices or a monolith?",
  "Explain how multi-agent AI systems work",
  "Write a launch tweet for a new coffee brand",
];

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
};

export default function Home() {
  const [task, setTask] = useState("");
  const [pattern, setPattern] = useState<Pattern>("orchestrator");
  const [critic, setCritic] = useState(false);
  const [web, setWeb] = useState(false);
  const [compare, setCompare] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);

  const started = tracks.length > 0 || running;
  const compareEnabled = pattern !== "single";

  async function run(input?: string) {
    const question = (input ?? task).trim();
    if (!question || running) return;
    if (input) setTask(input);

    setRunning(true);
    setError("");
    setTracks([]);

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
            handleEvent(JSON.parse(line.slice(5).trim()));
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

  function handleEvent(evt: {
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
    stats?: TrackStats;
  }) {
    if (evt.type === "error") {
      setError(evt.message ?? "Something went wrong.");
      return;
    }
    const trackId = evt.track ?? "A";
    setTracks((prev) => {
      const next = prev.map((t) => ({ ...t, nodes: [...t.nodes] }));
      let track = next.find((t) => t.id === trackId);
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
          }
          break;
        }
        case "final":
          track.final = {
            answer: evt.answer ?? "",
            sources: evt.sources ?? [],
            stats: evt.stats,
          };
          break;
      }
      return next;
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-14 sm:py-20">
      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-glow absolute left-1/2 top-[-15%] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-600/30 via-fuchsia-500/20 to-blue-500/30 blur-[130px]" />
        <div className="animate-glow absolute bottom-[-10%] left-[8%] h-[380px] w-[380px] rounded-full bg-blue-600/20 blur-[130px]" />
        <div className="animate-glow absolute right-[6%] top-[30%] h-[300px] w-[300px] rounded-full bg-fuchsia-600/15 blur-[130px]" />
      </div>

      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Multi-agent lab
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/40 bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-6xl">
            ✦ AgentShip
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/50">
            Run any task through different multi-agent patterns — and watch a
            team of ordinary models outthink a single call.
          </p>
        </div>

        {/* Controls */}
        <div className="mx-auto mt-8 max-w-3xl">
          {/* Pattern selector */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="mx-auto mt-4 max-w-3xl"
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
              placeholder="Give the agents a task…  (Enter to send, Shift+Enter for a new line)"
              rows={2}
              className="w-full resize-none bg-transparent px-4 py-3 pr-16 text-base outline-none placeholder:text-white/30"
            />
            <button
              type="submit"
              disabled={running || !task.trim()}
              aria-label="Run agents"
              className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-tr from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/40 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? (
                <span className="spinner h-5 w-5 rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <span className="text-xl leading-none">↑</span>
              )}
            </button>
          </div>
        </form>

        {/* Examples */}
        {!started && (
          <div className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                onClick={() => run(x)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 transition hover:border-white/20 hover:text-white"
              >
                {x}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {/* Tracks */}
        {tracks.length > 0 && (
          <div
            className={`mt-10 grid gap-5 ${
              tracks.length > 1 ? "lg:grid-cols-2" : "mx-auto max-w-3xl"
            }`}
          >
            {tracks.map((t) => (
              <TrackView key={t.id} track={t} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------- Components ----------

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
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
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

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-normal tabular-nums text-white/60">
      {label} {value}
    </span>
  );
}

function StatusDot({ state }: { state: "running" | "done" }) {
  if (state === "running")
    return (
      <span className="spinner inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-violet-400" />
    );
  return (
    <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-400">
      ✓
    </span>
  );
}

function TrackView({ track }: { track: Track }) {
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
            <span>✅</span> Final answer
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
    <div className="animate-fade-up rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-base">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white/85">{node.title}</div>
          <div className="truncate text-xs text-white/40">{node.subtitle}</div>
        </div>
        {node.state === "done" && node.ms !== undefined && (
          <span className="whitespace-nowrap text-[11px] tabular-nums text-white/30">
            {fmtMs(node.ms)}
            {node.tokens ? ` · ${node.tokens.toLocaleString()} tok` : ""}
          </span>
        )}
        <StatusDot state={node.state} />
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

// ---------- Tiny dependency-free markdown-ish renderer ----------

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
