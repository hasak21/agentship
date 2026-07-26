// AgentShip — multi-agent lab.
//
// One request runs the user's task through a chosen PATTERN, optionally with a
// CRITIC reflection pass and/or live WEB SEARCH, and optionally COMPARED against
// a single-agent baseline. Every agent is emitted as a generic "node" event so
// the UI can render any pattern with one component. All agents use the same
// ordinary model (Gemini flash) — the pattern is what does the work.
//
// Patterns:
//   single        one call (baseline)
//   orchestrator  Planner -> parallel Workers -> Synthesizer
//   debate        parallel Debaters (different angles) -> Judge
//   router        Router classifies the task -> one Specialist
// Add-on:
//   critic        Critic reviews the draft -> Reviser produces the final

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Model failover chain: if a model's free-tier quota is exhausted (429 after
// retries), the call automatically falls back to the next model in the chain.
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL ?? "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
// Google Search grounding works reliably on this model, so web calls use it.
const MODEL_WEB = "gemini-2.5-flash";
const urlFor = (model: string) => `${API_BASE}/${model}:generateContent`;

type Part = { thought?: boolean; text?: string };
type Chunk = { web?: { uri?: string; title?: string } };
type Source = { title: string; uri: string };
type Leaf = {
  text: string;
  sources: Source[];
  usage?: number;
  model?: string;
  failed?: boolean;
};
type Emit = (evt: Record<string, unknown>) => void;
type Opts = { web: boolean; critic: boolean };
type GeminiData = {
  candidates?: {
    content?: { parts?: Part[] };
    groundingMetadata?: { groundingChunks?: Chunk[] };
  }[];
  usageMetadata?: { totalTokenCount?: number };
};

// Circuit breaker: once a model reports 429 we stop dialling it for a cooldown
// window instead of re-discovering the same limit on every subsequent agent.
// Without this, a whole fan-out pays the retry latency of a known-dead model.
const MODEL_COOLDOWN_MS = 60_000;
const modelCooldown = new Map<string, number>();

const isCircuitOpen = (m: string) => (modelCooldown.get(m) ?? 0) > Date.now();
const tripCircuit = (m: string) =>
  modelCooldown.set(m, Date.now() + MODEL_COOLDOWN_MS);

// POST to Gemini with 429 retry + model failover.
// Per model: up to 2 attempts with backoff (per-minute burst limits).
// If a model stays rate-limited (e.g. daily quota exhausted), fall back to the
// next model in the chain. `model` fixes the first model tried (web calls).
async function postGemini(
  model: string | null,
  body: Record<string, unknown>
): Promise<GeminiData & { _model?: string }> {
  const full = model
    ? [model, ...MODEL_CHAIN.filter((m) => m !== model)]
    : MODEL_CHAIN;
  // Prefer models whose circuit is closed, but keep the rest as a last resort
  // so an over-eager breaker can never make the whole chain unreachable.
  const chain = [
    ...full.filter((m) => !isCircuitOpen(m)),
    ...full.filter(isCircuitOpen),
  ];

  let lastErr = "";
  for (const m of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(urlFor(m), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        modelCooldown.delete(m);
        return { ...data, _model: m };
      }
      lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status !== 429) throw new Error(lastErr);
      tripCircuit(m);
      // Rate-limited: brief backoff, then retry; second 429 moves down the chain.
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw new Error(lastErr || "Gemini: all models rate-limited");
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (s.uri && !seen.has(s.uri)) {
      seen.add(s.uri);
      out.push(s);
    }
  }
  return out.slice(0, 8);
}

// Free-text call, optionally grounded with Google Search.
// `temperature`, when set, overrides the model default — used to make
// independent samples of the same prompt genuinely diverge (self-consistency).
async function callText(
  system: string,
  user: string,
  web: boolean,
  temperature?: number
): Promise<Leaf> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
  };
  if (web) body.tools = [{ google_search: {} }];
  if (temperature !== undefined)
    body.generationConfig = { temperature };

  const data = await postGemini(web ? MODEL_WEB : null, body);
  const cand = data.candidates?.[0];
  const parts: Part[] = cand?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("\n")
    .trim();
  const chunks: Chunk[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const sources: Source[] = chunks
    .map((c) => c.web)
    .filter((w): w is { uri?: string; title?: string } => !!w?.uri)
    .map((w) => ({ title: w.title || w.uri || "source", uri: w.uri as string }));
  const usage: number = data?.usageMetadata?.totalTokenCount ?? 0;
  return { text, sources: dedupeSources(sources), usage, model: data._model };
}

// Structured JSON call (no web search). Returns the parsed value plus token usage.
async function callJSON<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>
): Promise<{ value: T; usage: number; model?: string }> {
  const data = await postGemini(null, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  const parts: Part[] = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();
  const usage: number = data?.usageMetadata?.totalTokenCount ?? 0;
  return { value: JSON.parse(text) as T, usage, model: data._model };
}

// Supervisor policy: no single agent may stall its whole track, and a
// transient failure gets one second chance before the track degrades.
const NODE_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 75_000);
const NODE_RETRIES = 1;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms
    );
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// Emit a node's lifecycle around an async unit of work.
// Failures are surfaced explicitly (`failed: true`) rather than being passed
// downstream as if they were an answer — see collapseFailures().
async function nodeRun(
  emit: Emit,
  track: string,
  node: { id: string; role: string; title: string; subtitle: string },
  fn: () => Promise<Leaf & Record<string, unknown>>
): Promise<Leaf & Record<string, unknown>> {
  emit({ track, type: "node", ...node });
  const t0 = Date.now();
  let res: Leaf & Record<string, unknown> | null = null;
  let lastMsg = "";

  for (let attempt = 0; attempt <= NODE_RETRIES; attempt++) {
    try {
      res = await withTimeout(fn(), NODE_TIMEOUT_MS);
      break;
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : String(e);
      // A retry only helps for transient faults; an exhausted quota is not one.
      const transient = !lastMsg.includes("429");
      if (attempt < NODE_RETRIES && transient) {
        emit({ track, type: "node_retry", id: node.id, reason: lastMsg });
        continue;
      }
      break;
    }
  }

  if (!res) {
    const text = lastMsg.includes("429")
      ? "(rate-limited: every model in the fallback chain hit its free quota — wait a minute and retry)"
      : lastMsg.includes("timeout")
        ? `(timed out after ${NODE_TIMEOUT_MS / 1000}s)`
        : "(this agent failed)";
    res = { text, sources: [], failed: true };
  }

  emit({
    track,
    type: "node_done",
    id: node.id,
    result: res.text,
    sources: res.sources ?? [],
    ms: Date.now() - t0,
    tokens: res.usage ?? 0,
    model: res.model,
    failed: res.failed === true,
    confidence: res.confidence,
  });
  return res;
}

// Drop failed agents from a fan-out before their placeholder text reaches a
// downstream synthesizer. Returns the survivors plus how many were lost, so
// the aggregating agent can be told honestly what it is missing.
function collapseFailures<T extends Record<string, unknown>>(
  results: T[]
): { ok: T[]; lost: number } {
  const ok = results.filter((r) => r.failed !== true);
  return { ok, lost: results.length - ok.length };
}

// Typed handoff: workers append a confidence line so the synthesizer can weigh
// their input instead of treating every sub-answer as equally reliable. Parsed
// out of free text (rather than forced JSON) so web-search grounding still works.
type Confidence = "high" | "medium" | "low";

function parseHandoff(text: string): {
  answer: string;
  confidence: Confidence;
  caveat: string;
} {
  const re = /^[>\s*_-]*CONFIDENCE:\s*(high|medium|low)\b[\s—:–-]*(.*)$/gim;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0)
    return { answer: text.trim(), confidence: "medium", caveat: "" };
  const last = matches[matches.length - 1];
  return {
    answer: text.slice(0, last.index).trim(),
    confidence: last[1].toLowerCase() as Confidence,
    caveat: (last[2] ?? "").trim(),
  };
}

function degradedNote(lost: number, total: number): string {
  return lost > 0
    ? `\n\nNOTE: ${lost} of ${total} agents failed and their input is missing. Answer as completely as you can from what remains, and do not mention the failures.`
    : "";
}

// ---------------- Patterns ----------------

async function runSingle(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  return nodeRun(
    emit,
    track,
    {
      id: "single",
      role: "agent",
      title: "Single agent",
      subtitle: "One model, one call (baseline)",
    },
    () =>
      callText(
        "You are a capable assistant. Answer the user's task clearly and completely.",
        q,
        opts.web
      ) as Promise<Leaf & Record<string, unknown>>
  );
}

async function runOrchestrator(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const plan = await nodeRun(
    emit,
    track,
    {
      id: "planner",
      role: "planner",
      title: "Planner",
      subtitle: "Splitting the task into sub-tasks",
    },
    async () => {
      let subtasks: string[];
      let usage = 0;
      let model: string | undefined;
      try {
        const r = await callJSON<string[]>(
          `You are the PLANNER. Break the task into 2 to 4 focused, independent sub-tasks that can run in parallel. Each one short. Return ONLY a JSON array of strings.`,
          q,
          { type: "ARRAY", items: { type: "STRING" } }
        );
        subtasks = r.value;
        usage = r.usage;
        model = r.model;
        if (!Array.isArray(subtasks) || subtasks.length === 0)
          subtasks = [q];
      } catch {
        subtasks = [q];
      }
      subtasks = subtasks.slice(0, 4).map((s) => String(s));
      return {
        text: subtasks.map((s, i) => `${i + 1}. ${s}`).join("\n"),
        sources: [],
        usage,
        model,
        subtasks,
      };
    }
  );
  const subtasks = (plan.subtasks as string[]) ?? [q];

  const results = await Promise.all(
    subtasks.map((st, i) =>
      nodeRun(
        emit,
        track,
        {
          id: `worker-${i}`,
          role: "worker",
          title: `Worker ${i + 1}`,
          subtitle: st,
        },
        async () => {
          const raw = await callText(
            `You are a WORKER. Complete ONLY your assigned sub-task thoroughly and accurately. Be concise but complete.
End your reply with one final line, exactly:
CONFIDENCE: high|medium|low — <short reason, or any caveat a reader should know>
Use "low" honestly when you are guessing or lack the information to be sure.`,
            `Overall task: ${q}\n\nYour sub-task: ${st}`,
            opts.web
          );
          const h = parseHandoff(raw.text);
          return {
            ...raw,
            text: h.answer,
            confidence: h.confidence,
            caveat: h.caveat,
            subtask: st,
          } as Leaf & Record<string, unknown>;
        }
      )
    )
  );

  // Failed workers must not reach the synthesizer as if their placeholder text
  // were an answer — drop them and tell the synthesizer what is missing.
  const { ok: live, lost } = collapseFailures(results);
  const combined = live
    .map((r, i) => {
      const conf = (r.confidence as string) ?? "medium";
      const caveat = (r.caveat as string) ?? "";
      return `## Sub-task ${i + 1}: ${r.subtask as string}\n[worker confidence: ${conf}${caveat ? ` — ${caveat}` : ""}]\n${r.text as string}`;
    })
    .join("\n\n");

  const synth = await nodeRun(
    emit,
    track,
    {
      id: "synth",
      role: "synthesizer",
      title: "Synthesizer",
      subtitle: "Merging results into a final answer",
    },
    () =>
      callText(
        `You are the SYNTHESIZER. Combine the worker sub-answers into ONE clear, well-structured final answer to the original task.
Each sub-answer is tagged with the worker's self-reported confidence. Weigh them accordingly: lean on high-confidence findings, and treat low-confidence claims with caution — hedge them or leave them out rather than stating them as fact.
Remove redundancy, resolve conflicts, use headings and bullets where helpful. Do not mention confidence levels or the workers themselves.`,
        `Original task: ${q}\n\nWorker results:\n${combined}${degradedNote(lost, results.length)}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );

  return {
    text: synth.text,
    sources: dedupeSources(results.flatMap((r) => r.sources)),
  };
}

async function runDebate(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const angles = [
    "practical and pragmatic",
    "critical and skeptical",
    "creative and big-picture",
  ];

  // Round 1 — opening statements, in parallel, blind to each other.
  const openings = await Promise.all(
    angles.map((angle, i) =>
      nodeRun(
        emit,
        track,
        {
          id: `debater-${i}-open`,
          role: "debater",
          title: `Debater ${i + 1}`,
          subtitle: `${angle} · opening statement`,
        },
        () =>
          callText(
            `You are DEBATER ${i + 1} on a panel. Answer the task from a ${angle} perspective. Make your strongest, most substantive case.`,
            q,
            opts.web
          ) as Promise<Leaf & Record<string, unknown>>
      )
    )
  );

  // Round 2 — rebuttals: each debater reads the surviving opponents and responds.
  const rebuttals = await Promise.all(
    angles.map((angle, i) => {
      const opponents = openings
        .map((o, j) =>
          j === i || o.failed
            ? null
            : `--- Debater ${j + 1} (${angles[j]}) argued ---\n${o.text}`
        )
        .filter(Boolean)
        .join("\n\n");
      return nodeRun(
        emit,
        track,
        {
          id: `debater-${i}-rebut`,
          role: "debater",
          title: `Debater ${i + 1}`,
          subtitle: `${angle} · rebuttal`,
        },
        () =>
          callText(
            `You are DEBATER ${i + 1} (${angle} perspective) in the rebuttal round of a debate.
Attack the weakest points in your opponents' arguments, concede their strongest points if honesty demands it, and state your improved FINAL position on the task.`,
            `Task: ${q}\n\nYour opening statement:\n${openings[i].text}\n\nYour opponents' arguments:\n${opponents}`,
            false
          ) as Promise<Leaf & Record<string, unknown>>
      );
    })
  );

  // Judge rules on the transcript of debaters who actually spoke.
  const speakers = angles
    .map((angle, i) => ({ angle, i }))
    .filter(({ i }) => !openings[i].failed);
  const transcript = speakers
    .map(({ angle, i }) => {
      const rebuttal = rebuttals[i].failed
        ? "(no rebuttal delivered)"
        : rebuttals[i].text;
      return `=== Debater ${i + 1} (${angle}) ===\nOpening:\n${openings[i].text}\n\nRebuttal & final position:\n${rebuttal}`;
    })
    .join("\n\n");
  const judge = await nodeRun(
    emit,
    track,
    {
      id: "judge",
      role: "judge",
      title: "Judge",
      subtitle: "Ruling on the full debate transcript",
    },
    () =>
      callText(
        "You are the JUDGE of a completed debate. You have the full transcript: opening statements and rebuttals. Weigh which arguments survived scrutiny, and produce the single best final answer to the task — combining the points that held up and discarding those that were successfully rebutted. Write the answer directly, as if answering the user's task; never narrate your role, the debate, or your deliberation process.",
        `Task: ${q}\n\nDebate transcript:\n${transcript}${degradedNote(
          angles.length - speakers.length,
          angles.length
        )}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );
  return {
    text: judge.text,
    sources: dedupeSources(openings.flatMap((d) => d.sources)),
  };
}

const SPECIALISTS: Record<string, { title: string; system: string }> = {
  code: {
    title: "Code specialist",
    system:
      "You are an expert software engineer. Solve the task with correct, idiomatic code and clear explanation.",
  },
  write: {
    title: "Writing specialist",
    system:
      "You are an expert writer and editor. Produce polished, well-structured prose for the task.",
  },
  analyze: {
    title: "Analysis specialist",
    system:
      "You are an expert analyst. Break the problem down with rigorous, structured reasoning and evidence.",
  },
  general: {
    title: "Generalist",
    system:
      "You are a knowledgeable generalist. Answer the task clearly and completely.",
  },
};

async function runRouter(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const choice = await nodeRun(
    emit,
    track,
    {
      id: "router",
      role: "router",
      title: "Router",
      subtitle: "Choosing the right specialist",
    },
    async () => {
      let route = "general";
      let reason = "";
      let usage = 0;
      let model: string | undefined;
      try {
        const r = await callJSON<{ route: string; reason?: string }>(
          "You are the ROUTER. Classify the task and choose the best specialist: code, write, analyze, or general. Return JSON {route, reason}.",
          q,
          {
            type: "OBJECT",
            properties: {
              route: { type: "STRING", enum: ["code", "write", "analyze", "general"] },
              reason: { type: "STRING" },
            },
            required: ["route"],
          }
        );
        usage = r.usage;
        model = r.model;
        if (SPECIALISTS[r.value.route]) route = r.value.route;
        reason = r.value.reason ?? "";
      } catch {
        route = "general";
      }
      return {
        text: `Routed to: **${SPECIALISTS[route].title}**${reason ? `\n${reason}` : ""}`,
        sources: [],
        usage,
        model,
        route,
      };
    }
  );
  const route = (choice.route as string) ?? "general";
  const spec = SPECIALISTS[route];
  const ans = await nodeRun(
    emit,
    track,
    {
      id: "specialist",
      role: "specialist",
      title: spec.title,
      subtitle: "Handling the task",
    },
    () =>
      callText(spec.system, q, opts.web) as Promise<
        Leaf & Record<string, unknown>
      >
  );
  return ans;
}

// Self-consistency: sample the SAME prompt several times independently, at
// higher temperature so the attempts can genuinely diverge, then have an
// Aggregator find the answer the samples actually agree on. The idea (Wang et
// al., 2022): errors in independent reasoning attempts tend to be random, but
// the correct answer tends to show up repeatedly — so majority-consistency is
// itself a signal of correctness, no critic or debate required.
const CONSISTENCY_SAMPLES = 4;

async function runConsistency(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const samples = await Promise.all(
    Array.from({ length: CONSISTENCY_SAMPLES }, (_, i) =>
      nodeRun(
        emit,
        track,
        {
          id: `sample-${i}`,
          role: "worker",
          title: `Sample ${i + 1}`,
          subtitle: "Independent reasoning attempt",
        },
        () =>
          callText(
            "Answer the task carefully and completely, reasoning step by step where helpful.",
            q,
            opts.web,
            0.9
          ) as Promise<Leaf & Record<string, unknown>>
      )
    )
  );

  // Only samples that actually completed get a vote.
  const { ok: votes, lost } = collapseFailures(samples);
  const transcript = votes
    .map((s, i) => `=== Sample ${i + 1} ===\n${s.text as string}`)
    .join("\n\n");
  const aggregate = await nodeRun(
    emit,
    track,
    {
      id: "aggregator",
      role: "synthesizer",
      title: "Aggregator",
      subtitle: `Voting across ${votes.length} independent samples`,
    },
    () =>
      callText(
        `You are the AGGREGATOR in a self-consistency ensemble. You are given ${votes.length} independent attempts at the same task.
Identify the answer/conclusion that the MAJORITY of samples agree on — that
consensus is the most trustworthy result, even if one or two samples differ.
Where samples disagree, briefly note the disagreement and explain which side
has more support. Produce ONE final answer to the task; do not just list the samples.`,
        `Task: ${q}\n\nIndependent samples:\n${transcript}${degradedNote(lost, samples.length)}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );
  return {
    text: aggregate.text,
    sources: dedupeSources(samples.flatMap((s) => s.sources)),
  };
}

// Iterative reflection: Critic reviews -> if rejected, Reviser fixes -> Critic
// re-reviews the new draft. Loops until the critic explicitly accepts or the
// round budget is exhausted.
const CRITIC_MAX_ROUNDS = 2;

async function withCritic(
  base: Leaf,
  q: string,
  emit: Emit,
  track: string
): Promise<Leaf> {
  let draft = base;
  for (let round = 1; round <= CRITIC_MAX_ROUNDS; round++) {
    const critique = await nodeRun(
      emit,
      track,
      {
        id: `critic-${round}`,
        role: "critic",
        title: "Critic",
        subtitle: `Review round ${round} of ${CRITIC_MAX_ROUNDS}`,
      },
      async () => {
        const r = await callJSON<{ accept: boolean; issues: string[] }>(
          `You are the CRITIC. Review the draft answer against the task.
Decide: is this draft good enough to ship as the final answer?
Accept unless there are SUBSTANTIVE problems (wrong facts, missing requirements, confusing structure) — do not reject for style nits.
Return JSON: {"accept": boolean, "issues": [concrete, actionable problems — empty if accepted]}.`,
          `Task: ${q}\n\nDraft answer:\n${draft.text}`,
          {
            type: "OBJECT",
            properties: {
              accept: { type: "BOOLEAN" },
              issues: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["accept", "issues"],
          }
        );
        return {
          text: r.value.accept
            ? "✅ Accepted — the draft is good enough to ship."
            : "Needs revision:\n" +
              r.value.issues.map((i) => `- ${i}`).join("\n"),
          sources: [],
          usage: r.usage,
          model: r.model,
          accept: r.value.accept,
        };
      }
    );

    // Fail-open: only an explicit rejection triggers a revision round.
    if (critique.accept !== false) break;

    const revised = await nodeRun(
      emit,
      track,
      {
        id: `reviser-${round}`,
        role: "reviser",
        title: "Reviser",
        subtitle: `Applying round-${round} feedback`,
      },
      () =>
        callText(
          "You are the REVISER. Produce an improved final answer to the task that fixes every valid point in the critique. Output only the improved answer.",
          `Task: ${q}\n\nDraft:\n${draft.text}\n\nCritique:\n${critique.text}`,
          false
        ) as Promise<Leaf & Record<string, unknown>>
    );
    draft = { text: revised.text, sources: draft.sources };
  }
  return draft;
}

const PATTERN_LABELS: Record<string, string> = {
  single: "Single agent",
  orchestrator: "Orchestrator",
  debate: "Debate",
  router: "Router",
  consistency: "Self-consistency",
  auto: "Auto",
};

// Meta-routing (pattern-of-patterns): rather than the user guessing which
// topology suits a task, an agent reasons about the task's shape and selects
// the pattern — then the system runs it. The selector is one cheap JSON call.
const PATTERN_GUIDE = `- orchestrator: broad tasks with separable parts that can be researched in parallel then merged (plans, reports, comparisons across several dimensions).
- debate: contested or opinion-shaped questions where the best answer emerges from arguing sides (should X or Y, trade-offs, judgement calls).
- consistency: questions with one correct-ish answer that a model can get wrong by accident (arithmetic, logic, factual recall, step-by-step reasoning).
- router: narrow, single-domain requests best handled by one specialist in one shot (write this snippet, draft this paragraph).
- single: trivial or conversational requests where multi-agent machinery would only add latency.`;

async function selectPattern(
  q: string,
  emit: Emit,
  track: string
): Promise<string> {
  const choice = await nodeRun(
    emit,
    track,
    {
      id: "meta",
      role: "router",
      title: "Meta-router",
      subtitle: "Choosing which multi-agent pattern fits this task",
    },
    async () => {
      const r = await callJSON<{ pattern: string; reason?: string }>(
        `You are the META-ROUTER of a multi-agent system. Analyse the task and choose which agent topology will produce the best answer:\n${PATTERN_GUIDE}\nReturn JSON {pattern, reason}. Keep the reason to one sentence.`,
        q,
        {
          type: "OBJECT",
          properties: {
            pattern: {
              type: "STRING",
              enum: ["orchestrator", "debate", "consistency", "router", "single"],
            },
            reason: { type: "STRING" },
          },
          required: ["pattern"],
        }
      );
      const picked = PATTERN_LABELS[r.value.pattern] ? r.value.pattern : "orchestrator";
      return {
        text: `Selected **${PATTERN_LABELS[picked]}**${r.value.reason ? `\n${r.value.reason}` : ""}`,
        sources: [],
        usage: r.usage,
        model: r.model,
        picked,
      };
    }
  );
  return (choice.picked as string) ?? "orchestrator";
}

async function runTrack(
  pattern: string,
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  // Wrap emit to tally calls + tokens as node_done events pass through.
  const stats = { calls: 0, tokens: 0 };
  const t0 = Date.now();
  const em: Emit = (evt) => {
    if (evt.type === "node_done") {
      stats.calls += 1;
      stats.tokens += (evt.tokens as number) || 0;
    }
    emit(evt);
  };

  // Auto: let a meta-agent choose the topology, then run it.
  let effective = pattern;
  if (pattern === "auto") {
    effective = await selectPattern(q, em, track);
    emit({
      track,
      type: "track_label",
      label: `Auto → ${PATTERN_LABELS[effective] ?? effective}`,
    });
  }

  let base: Leaf;
  switch (effective) {
    case "single":
      base = await runSingle(q, opts, em, track);
      break;
    case "debate":
      base = await runDebate(q, opts, em, track);
      break;
    case "router":
      base = await runRouter(q, opts, em, track);
      break;
    case "consistency":
      base = await runConsistency(q, opts, em, track);
      break;
    case "orchestrator":
    default:
      base = await runOrchestrator(q, opts, em, track);
      break;
  }
  if (opts.critic) base = await withCritic(base, q, em, track);
  emit({
    track,
    type: "final",
    answer: base.text,
    sources: base.sources,
    stats: { ...stats, ms: Date.now() - t0 },
  });
  return base;
}

// ---------------- Judge (compare mode) ----------------
//
// Blind pairwise evaluation: the judge sees "Answer X" and "Answer Y" with no
// hint of which pattern produced them. To cancel position bias we judge twice
// with the order swapped and average the scores.

type Rubric = { correctness: number; completeness: number; clarity: number };
type PairVerdict = { X: Rubric; Y: Rubric; rationale: string };

const RUBRIC_SCHEMA = {
  type: "OBJECT",
  properties: {
    correctness: { type: "NUMBER" },
    completeness: { type: "NUMBER" },
    clarity: { type: "NUMBER" },
  },
  required: ["correctness", "completeness", "clarity"],
};

async function judgeOnce(
  q: string,
  ansX: string,
  ansY: string
): Promise<{ v: PairVerdict; usage: number }> {
  const r = await callJSON<PairVerdict>(
    `You are an impartial JUDGE. Two anonymous assistants answered the same task.
Score each answer 1-10 on: correctness (factually right, no errors),
completeness (covers what the task needs), clarity (well structured, easy to use).
Judge only quality — never length; a concise answer that covers the task fully
deserves full marks. Refer to them only as "Answer X" and "Answer Y".
Give a one-sentence rationale for the comparison.`,
    `Task: ${q}\n\n=== Answer X ===\n${ansX}\n\n=== Answer Y ===\n${ansY}`,
    {
      type: "OBJECT",
      properties: {
        X: RUBRIC_SCHEMA,
        Y: RUBRIC_SCHEMA,
        rationale: { type: "STRING" },
      },
      required: ["X", "Y", "rationale"],
    }
  );
  return { v: r.value, usage: r.usage };
}

const total = (r: Rubric) => r.correctness + r.completeness + r.clarity;
const avg = (a: Rubric, b: Rubric): Rubric => ({
  correctness: (a.correctness + b.correctness) / 2,
  completeness: (a.completeness + b.completeness) / 2,
  clarity: (a.clarity + b.clarity) / 2,
});

async function runJudge(
  q: string,
  answerA: string,
  answerB: string,
  labelA: string,
  labelB: string,
  emit: Emit
): Promise<void> {
  emit({ type: "judging" });
  try {
    // Orientation 1: X=A, Y=B. Orientation 2: X=B, Y=A.
    const [o1, o2] = await Promise.all([
      judgeOnce(q, answerA, answerB),
      judgeOnce(q, answerB, answerA),
    ]);
    const scoreA = avg(o1.v.X, o2.v.Y);
    const scoreB = avg(o1.v.Y, o2.v.X);
    const diff = total(scoreA) - total(scoreB);
    const winner = Math.abs(diff) < 0.5 ? "tie" : diff > 0 ? "A" : "B";
    const rationale = o1.v.rationale
      .replaceAll("Answer X", labelA)
      .replaceAll("Answer Y", labelB);
    emit({
      type: "verdict",
      scores: { A: scoreA, B: scoreB },
      totals: { A: total(scoreA), B: total(scoreB) },
      winner,
      rationale,
      tokens: o1.usage + o2.usage,
    });
  } catch {
    emit({
      type: "verdict_error",
      message: "The judge could not score this run (likely rate-limited).",
    });
  }
}

export async function POST(request: Request) {
  let body: {
    question?: string;
    pattern?: string;
    critic?: boolean;
    web?: boolean;
    compare?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    // handled below
  }
  const question = (body.question ?? "").trim();
  const pattern = body.pattern ?? "orchestrator";
  const critic = !!body.critic;
  const web = !!body.web;
  const compare = !!body.compare;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Emit = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        if (!question) {
          send({ type: "error", message: "Please enter a task." });
          return;
        }
        if (!process.env.GEMINI_API_KEY) {
          send({ type: "error", message: "Server is missing GEMINI_API_KEY." });
          return;
        }

        const doCompare = compare && pattern !== "single";
        if (doCompare) {
          const labelA = PATTERN_LABELS[pattern] ?? pattern;
          const labelB = "Single agent (baseline)";
          send({ type: "track", track: "A", pattern, label: labelA });
          send({ type: "track", track: "B", pattern: "single", label: labelB });
          const [finalA, finalB] = await Promise.all([
            runTrack(pattern, question, { web, critic }, send, "A"),
            runTrack("single", question, { web, critic: false }, send, "B"),
          ]);
          // Blind-judge the two final answers.
          await runJudge(
            question,
            finalA.text,
            finalB.text,
            labelA,
            labelB,
            send
          );
        } else {
          send({ type: "track", track: "A", pattern, label: PATTERN_LABELS[pattern] ?? pattern });
          await runTrack(pattern, question, { web, critic }, send, "A");
        }
        send({ type: "done" });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        console.error("Multi-agent route error:", err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
