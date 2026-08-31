// AgentShip — Universal Multi-Agent Orchestration Engine.
//
// Runs a task through chosen multi-agent topologies (Orchestrator, Debate,
// Router, Self-Consistency, Single Baseline, Auto) with optional Critic reflection,
// Web Search grounding, and Blind Pairwise Judge evaluation.
// Fully decoupled from any specific model provider (Universal LLM Engine).

import {
  callUniversalLLM,
  extractJsonFromResponse,
  LLMRequestOptions,
  LLMResponse,
  LLMSource,
  resolveProviderConfig,
} from "@/lib/llm";

type Source = LLMSource;

type Leaf = {
  text: string;
  sources: Source[];
  usage?: number;
  model?: string;
  failed?: boolean;
  confidence?: "high" | "medium" | "low";
  caveat?: string;
  subtask?: string;
  [key: string]: unknown;
};

type Emit = (evt: Record<string, unknown>) => void;
type Opts = {
  web: boolean;
  critic: boolean;
  llmOptions?: LLMRequestOptions;
};

// Universal free-text call
async function callText(
  system: string,
  user: string,
  web: boolean,
  temperature?: number,
  llmOptions?: LLMRequestOptions
): Promise<Leaf> {
  const res: LLMResponse = await callUniversalLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      ...llmOptions,
      temperature: temperature ?? 0.7,
      webSearch: web,
    }
  );

  return {
    text: res.text,
    sources: res.sources ?? [],
    usage: res.usage.totalTokens,
    model: res.model,
  };
}

// Universal structured JSON call
async function callJSON<T>(
  system: string,
  user: string,
  schemaDescription: string,
  llmOptions?: LLMRequestOptions
): Promise<{ value: T; usage: number; model?: string }> {
  const fullSystem = `${system}\n\nIMPORTANT: Return ONLY a valid JSON object or array according to this requirement:\n${schemaDescription}`;

  const res: LLMResponse = await callUniversalLLM(
    [
      { role: "system", content: fullSystem },
      { role: "user", content: user },
    ],
    {
      ...llmOptions,
      temperature: 0.2,
      responseFormat: "json_object",
    }
  );

  const value = extractJsonFromResponse<T>(res.text);
  return {
    value,
    usage: res.usage.totalTokens,
    model: res.model,
  };
}

// Supervisor policy: timeout and retry
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

// Supervisor node lifecycle wrapper
async function nodeRun(
  emit: Emit,
  track: string,
  node: { id: string; role: string; title: string; subtitle: string },
  fn: () => Promise<Leaf>
): Promise<Leaf> {
  emit({ track, type: "node", ...node });
  const t0 = Date.now();
  let res: Leaf | null = null;
  let lastMsg = "";

  for (let attempt = 0; attempt <= NODE_RETRIES; attempt++) {
    try {
      res = await withTimeout(fn(), NODE_TIMEOUT_MS);
      break;
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : String(e);
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
      ? "(rate-limited: model hit quota limits — please wait a moment or configure alternative provider)"
      : lastMsg.includes("timeout")
        ? `(timed out after ${NODE_TIMEOUT_MS / 1000}s)`
        : `(agent execution failed: ${lastMsg})`;
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

function collapseFailures<T extends Record<string, unknown>>(
  results: T[]
): { ok: T[]; lost: number } {
  const ok = results.filter((r) => r.failed !== true);
  return { ok, lost: results.length - ok.length };
}

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

// ---------------- Topologies ----------------

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
        "You are a capable assistant. Answer the user's task clearly, rigorously, and completely.",
        q,
        opts.web,
        undefined,
        opts.llmOptions
      )
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
      subtitle: "Decomposing task into parallel sub-tasks",
    },
    async () => {
      let subtasks: string[];
      let usage = 0;
      let model: string | undefined;
      try {
        const r = await callJSON<string[]>(
          `You are the PLANNER. Break the task into 2 to 4 focused, independent sub-tasks that can run in parallel. Return ONLY a JSON array of strings.`,
          q,
          `["Subtask 1 description", "Subtask 2 description", ...]`,
          opts.llmOptions
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
            opts.web,
            undefined,
            opts.llmOptions
          );
          const h = parseHandoff(raw.text);
          return {
            ...raw,
            text: h.answer,
            confidence: h.confidence,
            caveat: h.caveat,
            subtask: st,
          };
        }
      )
    )
  );

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
      subtitle: "Merging worker outputs into final coherent result",
    },
    async () => {
      const r = await callText(
        `You are the SYNTHESIZER. Multiple parallel workers researched parts of a user's task.
Combine their findings into one unified, cohesive, high-quality response to the overall task.
Each worker provided a CONFIDENCE tag (high/medium/low). Rely firmly on high-confidence findings;
hedge or omit claims tagged low-confidence.
Do NOT just paste the sections together — resolve contradictions and write a seamless answer.`,
        `Overall task: ${q}\n\n=== Worker Findings ===\n${combined}${degradedNote(lost, results.length)}`,
        false,
        undefined,
        opts.llmOptions
      );
      const allSources = results.flatMap((res) => res.sources ?? []);
      return { ...r, sources: allSources };
    }
  );

  return synth;
}

async function runDebate(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const debaterConfigs = [
    {
      id: "debater-1",
      title: "Debater 1 (Pragmatist)",
      angle: "practical, real-world constraints, implementation feasibility, and operational simplicity",
    },
    {
      id: "debater-2",
      title: "Debater 2 (Skeptic)",
      angle: "edge cases, security failure modes, hidden assumptions, and theoretical limits",
    },
    {
      id: "debater-3",
      title: "Debater 3 (Innovator)",
      angle: "creative alternatives, first-principles redesign, and high-leverage solutions",
    },
  ];

  // Round 1: Opening statements
  const openings = await Promise.all(
    debaterConfigs.map((d) =>
      nodeRun(
        emit,
        track,
        {
          id: d.id,
          role: "debater",
          title: d.title,
          subtitle: `Opening position emphasizing ${d.angle}`,
        },
        () =>
          callText(
            `You are a debater in a multi-perspective panel addressing the user's task.
Focus especially on: ${d.angle}.
State your strongest, most persuasive opening argument.`,
            `Task: ${q}`,
            opts.web,
            undefined,
            opts.llmOptions
          )
      )
    )
  );

  const { ok: liveOpenings } = collapseFailures(openings);
  const openingDigest = liveOpenings
    .map((o, idx) => `=== ${debaterConfigs[idx]?.title ?? `Debater ${idx + 1}`} ===\n${o.text}`)
    .join("\n\n");

  // Round 2: Rebuttal round
  const rebuttals = await Promise.all(
    debaterConfigs.map((d, i) =>
      nodeRun(
        emit,
        track,
        {
          id: `rebuttal-${i + 1}`,
          role: "debater",
          title: `${d.title} (Rebuttal)`,
          subtitle: "Critiquing counter-arguments and refining position",
        },
        () =>
          callText(
            `You are ${d.title}. You have heard your peers' opening statements.
Challenge weak assumptions, concede valid points, and present your refined concluding recommendation.`,
            `Task: ${q}\n\n=== All Opening Statements ===\n${openingDigest}`,
            opts.web,
            undefined,
            opts.llmOptions
          )
      )
    )
  );

  const { ok: liveRebuttals } = collapseFailures(rebuttals);
  const debateTranscript = liveRebuttals
    .map((r, idx) => `=== ${debaterConfigs[idx]?.title ?? `Debater ${idx + 1}`} Final Argument ===\n${r.text}`)
    .join("\n\n");

  // Round 3: Judge ruling
  const ruling = await nodeRun(
    emit,
    track,
    {
      id: "judge",
      role: "judge",
      title: "Judge",
      subtitle: "Synthesizing full debate into authoritative consensus",
    },
    async () => {
      const r = await callText(
        `You are the Chief Arbitrator / Senior Judge.
Review the complete debate transcript. Weigh the evidence and deliver the definitive answer to the user's task.`,
        `Task: ${q}\n\n=== Debate Transcript ===\n${debateTranscript}`,
        false,
        undefined,
        opts.llmOptions
      );
      const allSources = [...openings, ...rebuttals].flatMap((res) => res.sources ?? []);
      return { ...r, sources: allSources };
    }
  );

  return ruling;
}

async function runRouter(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const routerNode = await nodeRun(
    emit,
    track,
    {
      id: "router",
      role: "router",
      title: "Intent Router",
      subtitle: "Classifying domain specialization",
    },
    async () => {
      let classification = "general";
      let reasoning = "";
      let usage = 0;
      let model: string | undefined;

      try {
        const r = await callJSON<{ domain: string; reasoning: string }>(
          `Classify the given task into exactly ONE of: ["code", "architecture", "security", "writing", "analysis", "general"].
Explain your classification in one sentence.`,
          q,
          `{ "domain": "code|architecture|security|writing|analysis|general", "reasoning": "string" }`,
          opts.llmOptions
        );
        classification = r.value.domain || "general";
        reasoning = r.value.reasoning || "";
        usage = r.usage;
        model = r.model;
      } catch {
        classification = "general";
      }

      return {
        text: `Routed to domain: [${classification.toUpperCase()}] — ${reasoning}`,
        sources: [],
        usage,
        model,
        domain: classification,
      };
    }
  );

  const domain = (routerNode.domain as string) || "general";

  const specialistPromptMap: Record<string, string> = {
    code: "You are a Principal Software Engineer. Provide idiomatic, performant, production-ready code with tests.",
    architecture: "You are a Chief Enterprise Architect. Detail system topologies, scalability, and trade-offs.",
    security: "You are a Principal Security Auditor. Analyze threat vectors, mitigation strategies, and vulnerabilities.",
    writing: "You are a Principal Technical Writer. Provide clear, structured, engaging documentation.",
    analysis: "You are a Senior Quantitative Analyst. Provide rigorous reasoning and step-by-step logic.",
    general: "You are an expert polymath assistant. Answer thoroughly and clearly.",
  };

  const specialistPrompt = specialistPromptMap[domain] || specialistPromptMap.general;

  const result = await nodeRun(
    emit,
    track,
    {
      id: "specialist",
      role: "specialist",
      title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Specialist`,
      subtitle: `Domain expert answering request`,
    },
    () => callText(specialistPrompt, q, opts.web, undefined, opts.llmOptions)
  );

  return result;
}

async function runConsistency(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const SAMPLES_COUNT = 4;
  const sampleIndices = Array.from({ length: SAMPLES_COUNT }, (_, i) => i + 1);

  const samples = await Promise.all(
    sampleIndices.map((idx) =>
      nodeRun(
        emit,
        track,
        {
          id: `sample-${idx}`,
          role: "worker",
          title: `Reasoning Path #${idx}`,
          subtitle: "Independent stochastic sampling (temp=0.9)",
        },
        () =>
          callText(
            "Solve the user's task step-by-step. Be rigorous, self-verify your reasoning, and state your final conclusion clearly.",
            q,
            opts.web,
            0.9,
            opts.llmOptions
          )
      )
    )
  );

  const { ok: liveSamples } = collapseFailures(samples);
  const sampleDigest = liveSamples
    .map((s, i) => `=== Sample ${i + 1} ===\n${s.text}`)
    .join("\n\n");

  const aggregator = await nodeRun(
    emit,
    track,
    {
      id: "aggregator",
      role: "synthesizer",
      title: "Consensus Aggregator",
      subtitle: "Self-Consistency majority voting and convergence",
    },
    async () => {
      const r = await callText(
        `You are the Self-Consistency Aggregator. You are given 4 independent reasoning samples for the same task.
Identify the majority consensus answer, resolve any discrepancies, and provide the definitive solution.`,
        `Task: ${q}\n\n=== Independent Samples ===\n${sampleDigest}`,
        false,
        undefined,
        opts.llmOptions
      );
      const allSources = samples.flatMap((s) => s.sources ?? []);
      return { ...r, sources: allSources };
    }
  );

  return aggregator;
}

async function runAuto(
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const metaNode = await nodeRun(
    emit,
    track,
    {
      id: "meta-router",
      role: "router",
      title: "Meta-Orchestrator",
      subtitle: "Selecting optimal topology for task shape",
    },
    async () => {
      let chosenPattern = "orchestrator";
      let rationale = "";
      let usage = 0;
      let model: string | undefined;

      try {
        const r = await callJSON<{ pattern: string; rationale: string }>(
          `Analyze the task shape and select the optimal multi-agent topology from:
- "orchestrator": for broad, decomposable tasks with distinct sub-parts
- "debate": for open-ended questions with trade-offs, architecture choices, or contested opinions
- "router": for specific single-domain questions needing a specialist
- "consistency": for algorithmic, mathematical, or logic puzzles with exact answers
- "single": for simple, direct queries`,
          q,
          `{ "pattern": "orchestrator|debate|router|consistency|single", "rationale": "string" }`,
          opts.llmOptions
        );
        chosenPattern = r.value.pattern || "orchestrator";
        rationale = r.value.rationale || "";
        usage = r.usage;
        model = r.model;
      } catch {
        chosenPattern = "orchestrator";
      }

      return {
        text: `Selected [${chosenPattern.toUpperCase()}]: ${rationale}`,
        sources: [],
        usage,
        model,
        pattern: chosenPattern,
      };
    }
  );

  const selected = (metaNode.pattern as string) || "orchestrator";
  emit({ track, type: "relabel", label: `Auto → ${selected}` });

  switch (selected) {
    case "debate":
      return runDebate(q, opts, emit, track);
    case "router":
      return runRouter(q, opts, emit, track);
    case "consistency":
      return runConsistency(q, opts, emit, track);
    case "single":
      return runSingle(q, opts, emit, track);
    case "orchestrator":
    default:
      return runOrchestrator(q, opts, emit, track);
  }
}

// Optional Critic Reflection Loop
async function runCriticPass(
  q: string,
  draft: Leaf,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  let currentDraft = draft.text;
  let allSources = draft.sources ?? [];

  for (let round = 1; round <= 2; round++) {
    const criticVerdict = await nodeRun(
      emit,
      track,
      {
        id: `critic-${round}`,
        role: "critic",
        title: `Critic (Round ${round})`,
        subtitle: "Scrutinizing draft for bugs, omissions, and hallucinations",
      },
      async () => {
        let accept = true;
        let issues: string[] = [];
        let usage = 0;
        let model: string | undefined;

        try {
          const r = await callJSON<{ accept: boolean; issues: string[] }>(
            `You are a strict CRITIC. Scrutinize the draft response against the user's task.
If the draft is accurate, complete, and high quality, set accept=true.
If it has notable flaws, omissions, or errors, set accept=false and list actionable issues.`,
            `Task: ${q}\n\n=== Draft ===\n${currentDraft}`,
            `{ "accept": boolean, "issues": ["issue 1", "issue 2"] }`,
            opts.llmOptions
          );
          accept = r.value.accept;
          issues = r.value.issues || [];
          usage = r.usage;
          model = r.model;
        } catch {
          accept = true;
        }

        return {
          text: accept ? "✓ Draft approved without revisions." : `Issues found:\n${issues.map((it) => `- ${it}`).join("\n")}`,
          sources: [],
          usage,
          model,
          accept,
          issues,
        };
      }
    );

    if (criticVerdict.accept) {
      break;
    }

    const reviser = await nodeRun(
      emit,
      track,
      {
        id: `reviser-${round}`,
        role: "reviser",
        title: `Reviser (Round ${round})`,
        subtitle: "Fixing identified critique points",
      },
      async () => {
        const r = await callText(
          `You are the REVISER. Improve and rewrite the draft based on the Critic's feedback.`,
          `Task: ${q}\n\n=== Previous Draft ===\n${currentDraft}\n\n=== Critic Issues ===\n${criticVerdict.text}`,
          opts.web,
          undefined,
          opts.llmOptions
        );
        allSources = [...allSources, ...(r.sources ?? [])];
        return r;
      }
    );

    currentDraft = reviser.text;
  }

  return {
    text: currentDraft,
    sources: allSources,
  };
}

async function runTrack(
  pattern: string,
  q: string,
  opts: Opts,
  emit: Emit,
  track: string
): Promise<Leaf> {
  const t0 = Date.now();
  let finalLeaf: Leaf;

  switch (pattern) {
    case "single":
      finalLeaf = await runSingle(q, opts, emit, track);
      break;
    case "debate":
      finalLeaf = await runDebate(q, opts, emit, track);
      break;
    case "router":
      finalLeaf = await runRouter(q, opts, emit, track);
      break;
    case "consistency":
      finalLeaf = await runConsistency(q, opts, emit, track);
    case "auto":
      finalLeaf = await runAuto(q, opts, emit, track);
      break;
    case "orchestrator":
    default:
      finalLeaf = await runOrchestrator(q, opts, emit, track);
      break;
  }

  if (opts.critic) {
    finalLeaf = await runCriticPass(q, finalLeaf, opts, emit, track);
  }

  emit({
    track,
    type: "final",
    answer: finalLeaf.text,
    sources: finalLeaf.sources ?? [],
    stats: { ms: Date.now() - t0 },
  });

  return finalLeaf;
}

// Double-Blind Pairwise LLM-as-Judge
type Rubric = { correctness: number; completeness: number; clarity: number };

async function judgeOnce(
  q: string,
  ansX: string,
  ansY: string,
  llmOptions?: LLMRequestOptions
): Promise<{ v: { X: Rubric; Y: Rubric; rationale: string }; usage: number }> {
  const r = await callJSON<{ X: Rubric; Y: Rubric; rationale: string }>(
    `You are an impartial double-blind JUDGE. Score each answer 1-10 on correctness, completeness, and clarity.`,
    `Task: ${q}\n\n=== Answer X ===\n${ansX}\n\n=== Answer Y ===\n${ansY}`,
    `{
  "X": { "correctness": 8.5, "completeness": 9.0, "clarity": 8.5 },
  "Y": { "correctness": 9.0, "completeness": 8.0, "clarity": 9.0 },
  "rationale": "Comparative rationale..."
}`,
    llmOptions
  );

  return { v: r.value, usage: r.usage };
}

const total = (r: Rubric) => (r.correctness || 0) + (r.completeness || 0) + (r.clarity || 0);
const avg = (a: Rubric, b: Rubric): Rubric => ({
  correctness: ((a.correctness || 0) + (b.correctness || 0)) / 2,
  completeness: ((a.completeness || 0) + (b.completeness || 0)) / 2,
  clarity: ((a.clarity || 0) + (b.clarity || 0)) / 2,
});

async function runJudge(
  q: string,
  answerA: string,
  answerB: string,
  labelA: string,
  labelB: string,
  emit: Emit,
  llmOptions?: LLMRequestOptions
): Promise<void> {
  emit({ type: "judging" });
  try {
    const [o1, o2] = await Promise.all([
      judgeOnce(q, answerA, answerB, llmOptions),
      judgeOnce(q, answerB, answerA, llmOptions),
    ]);

    const scoreA = avg(o1.v.X, o2.v.Y);
    const scoreB = avg(o1.v.Y, o2.v.X);
    const diff = total(scoreA) - total(scoreB);
    const winner = Math.abs(diff) < 0.5 ? "tie" : diff > 0 ? "A" : "B";
    const rationale = (o1.v.rationale || "")
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
      message: "The evaluator could not score this run (rate-limited or format error).",
    });
  }
}

const PATTERN_LABELS: Record<string, string> = {
  orchestrator: "Orchestrator (Plan → Workers → Synth)",
  debate: "Debate (Panel → Rebuttal → Judge)",
  router: "Router (Specialist Dispatch)",
  consistency: "Self-Consistency (Stochastic Voting)",
  single: "Single Agent (Baseline)",
  auto: "Auto (Meta-Routing)",
};

export async function POST(request: Request) {
  let body: {
    question?: string;
    pattern?: string;
    critic?: boolean;
    web?: boolean;
    compare?: boolean;
    model?: string;
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
  } = {};

  try {
    body = await request.json();
  } catch {
    // Handled below
  }

  const question = (body.question ?? "").trim();
  const pattern = body.pattern ?? "orchestrator";
  const critic = !!body.critic;
  const web = !!body.web;
  const compare = !!body.compare;

  const llmOptions: LLMRequestOptions = {
    model: body.model,
    provider: body.provider as LLMRequestOptions["provider"],
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Emit = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        if (!question) {
          send({ type: "error", message: "Please provide a task to execute." });
          return;
        }

        const resolved = resolveProviderConfig(llmOptions);
        if (!resolved.apiKey && resolved.provider !== "ollama" && !resolved.baseUrl.includes("localhost")) {
          // Check if any key is available
          const hasAnyKey =
            process.env.OPENAI_API_KEY ||
            process.env.DEEPSEEK_API_KEY ||
            process.env.ANTHROPIC_API_KEY ||
            process.env.LLM_API_KEY ||
            process.env.GEMINI_API_KEY;

          if (!hasAnyKey) {
            send({
              type: "error",
              message:
                "No LLM provider configured. Please set OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or start Ollama locally.",
            });
            return;
          }
        }

        const doCompare = compare && pattern !== "single";
        if (doCompare) {
          const labelA = PATTERN_LABELS[pattern] ?? pattern;
          const labelB = "Single agent (baseline)";
          send({ type: "track", track: "A", pattern, label: labelA });
          send({ type: "track", track: "B", pattern: "single", label: labelB });

          const [finalA, finalB] = await Promise.all([
            runTrack(pattern, question, { web, critic, llmOptions }, send, "A"),
            runTrack("single", question, { web, critic: false, llmOptions }, send, "B"),
          ]);

          await runJudge(
            question,
            finalA.text,
            finalB.text,
            labelA,
            labelB,
            send,
            llmOptions
          );
        } else {
          send({
            type: "track",
            track: "A",
            pattern,
            label: PATTERN_LABELS[pattern] ?? pattern,
          });
          await runTrack(pattern, question, { web, critic, llmOptions }, send, "A");
        }

        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
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
