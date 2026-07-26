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
type Leaf = { text: string; sources: Source[]; usage?: number; model?: string };
type Emit = (evt: Record<string, unknown>) => void;
type Opts = { web: boolean; critic: boolean };
type GeminiData = {
  candidates?: {
    content?: { parts?: Part[] };
    groundingMetadata?: { groundingChunks?: Chunk[] };
  }[];
  usageMetadata?: { totalTokenCount?: number };
};

// POST to Gemini with 429 retry + model failover.
// Per model: up to 2 attempts with backoff (per-minute burst limits).
// If a model stays rate-limited (e.g. daily quota exhausted), fall back to the
// next model in the chain. `model` fixes the first model tried (web calls).
async function postGemini(
  model: string | null,
  body: Record<string, unknown>
): Promise<GeminiData & { _model?: string }> {
  const chain = model
    ? [model, ...MODEL_CHAIN.filter((m) => m !== model)]
    : MODEL_CHAIN;
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
        return { ...data, _model: m };
      }
      lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status !== 429) throw new Error(lastErr);
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
async function callText(
  system: string,
  user: string,
  web: boolean
): Promise<Leaf> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
  };
  if (web) body.tools = [{ google_search: {} }];

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

// Emit a node's lifecycle around an async unit of work.
async function nodeRun(
  emit: Emit,
  track: string,
  node: { id: string; role: string; title: string; subtitle: string },
  fn: () => Promise<Leaf & Record<string, unknown>>
): Promise<Leaf & Record<string, unknown>> {
  emit({ track, type: "node", ...node });
  const t0 = Date.now();
  let res: Leaf & Record<string, unknown>;
  try {
    res = await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const text = msg.includes("429")
      ? "(rate-limited: every model in the fallback chain hit its free quota — wait a minute and retry)"
      : "(this agent failed)";
    res = { text, sources: [] };
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
  });
  return res;
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
        () =>
          callText(
            "You are a WORKER. Complete ONLY your assigned sub-task thoroughly and accurately. Be concise but complete.",
            `Overall task: ${q}\n\nYour sub-task: ${st}`,
            opts.web
          ) as Promise<Leaf & Record<string, unknown>>
      )
    )
  );

  const combined = subtasks
    .map((s, i) => `## Sub-task ${i + 1}: ${s}\n${results[i].text}`)
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
        "You are the SYNTHESIZER. Combine the worker sub-answers into ONE clear, well-structured final answer to the original task. Remove redundancy, resolve conflicts, use headings and bullets where helpful.",
        `Original task: ${q}\n\nWorker results:\n${combined}`,
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
  const debaters = await Promise.all(
    angles.map((angle, i) =>
      nodeRun(
        emit,
        track,
        {
          id: `debater-${i}`,
          role: "debater",
          title: `Debater ${i + 1}`,
          subtitle: `${angle} view`,
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
  const combined = debaters
    .map((d, i) => `### Debater ${i + 1} (${angles[i]}):\n${d.text}`)
    .join("\n\n");
  const judge = await nodeRun(
    emit,
    track,
    {
      id: "judge",
      role: "judge",
      title: "Judge",
      subtitle: "Weighing the arguments",
    },
    () =>
      callText(
        "You are the JUDGE. Weigh the panel's arguments and produce the single best final answer, combining the strongest points and discarding weak ones.",
        `Task: ${q}\n\nPanel answers:\n${combined}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );
  return {
    text: judge.text,
    sources: dedupeSources(debaters.flatMap((d) => d.sources)),
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

async function withCritic(
  base: Leaf,
  q: string,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const critique = await nodeRun(
    emit,
    track,
    {
      id: "critic",
      role: "critic",
      title: "Critic",
      subtitle: "Reviewing the draft for gaps and errors",
    },
    () =>
      callText(
        "You are the CRITIC. Review the draft answer against the task. List concrete problems, gaps, or errors as short bullet points. If it is already excellent, say so briefly.",
        `Task: ${q}\n\nDraft answer:\n${base.text}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );
  const revised = await nodeRun(
    emit,
    track,
    {
      id: "reviser",
      role: "reviser",
      title: "Reviser",
      subtitle: "Applying the feedback",
    },
    () =>
      callText(
        "You are the REVISER. Produce an improved final answer to the task that fixes every valid point in the critique. Output only the improved answer.",
        `Task: ${q}\n\nDraft:\n${base.text}\n\nCritique:\n${critique.text}`,
        false
      ) as Promise<Leaf & Record<string, unknown>>
  );
  return { text: revised.text, sources: base.sources };
}

const PATTERN_LABELS: Record<string, string> = {
  single: "Single agent",
  orchestrator: "Orchestrator",
  debate: "Debate",
  router: "Router",
};

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

  let base: Leaf;
  switch (pattern) {
    case "single":
      base = await runSingle(q, opts, em, track);
      break;
    case "debate":
      base = await runDebate(q, opts, em, track);
      break;
    case "router":
      base = await runRouter(q, opts, em, track);
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
