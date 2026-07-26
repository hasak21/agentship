# AgentShip — Technical Report & Project Direction

**Version:** 1.0 · **Date:** 2026-07-27
**Repository:** https://github.com/hasak21/agentship
**Domains:** agentship.online · agentship.space

---

## 0. Executive summary

AgentShip is a **multi-agent orchestration lab**: a system that runs the same task
through different agent topologies — and measures which one actually produced the
better answer.

The founding thesis is deliberately narrow and testable:

> A team of *ordinary* models, arranged in the right pattern, can outperform a
> single call to the same model. The gain comes from the **topology**, not from a
> bigger model.

Everything in the codebase exists to make that claim falsifiable. Every agent runs
on the same cheap model (Gemini Flash class). The only variable is how the agents
are wired together. A built-in blind judge scores the outputs, so the answer to
"did the pattern help?" is a number, not an opinion.

Current state: **6 topologies, 3 stackable modifiers, per-agent telemetry, and an
automated evaluator**, in ~1,850 lines of dependency-free TypeScript.

---

## 1. What exists today

### 1.1 Topologies

| Pattern | Structure | Best suited to |
|---|---|---|
| **Single** | One call | Baseline / control group |
| **Orchestrator** | Planner → parallel Workers → Synthesizer | Broad tasks with separable parts |
| **Debate** | 3 Debaters (opening) → rebuttal round → Judge | Contested, judgement-shaped questions |
| **Router** | Classifier → one Specialist | Narrow, single-domain requests |
| **Self-consistency** | 4 independent samples @ temp 0.9 → Aggregator votes | Tasks with a correct answer reachable by faulty reasoning |
| **Auto** | Meta-agent selects the topology, then delegates | Unknown / mixed workloads |

### 1.2 Stackable modifiers

- **Critic pass** — iterative reflection. The Critic returns a structured verdict
  (`accept` / `issues[]`); on rejection the Reviser fixes the draft and the Critic
  **re-reviews it**, looping up to 2 rounds with early stop on acceptance.
- **Web search** — Google Search grounding with cited sources.
- **Compare vs single** — runs the chosen topology *and* the single-agent baseline
  concurrently, then blind-judges both.

### 1.3 Measurement layer

This is the part most "agent framework" projects lack, and it is the strategic core
of AgentShip.

- **Per-agent telemetry** — wall time, token usage, and which model actually served
  each call, streamed live.
- **Per-track aggregate** — total calls, tokens, wall-clock.
- **Blind pairwise judge** — both answers are anonymised to "Answer X" / "Answer Y",
  scored 1–10 on *correctness / completeness / clarity*, then **judged a second time
  with the positions swapped** and averaged to cancel position bias.

The result: a run produces a verdict like *Orchestrator 25.0 vs Single 30.0* — and
in real testing the single agent **has won**, repeatedly. That negative result is a
feature. A lab that only confirms its own thesis is marketing; one that can
disconfirm it is an instrument.

### 1.4 Reliability engineering

Multi-agent systems fail in ways single calls do not: one hung agent stalls a whole
fan-out, and one failed agent silently poisons the synthesis step. Both are handled:

- **Per-node timeout** (75s, configurable) — no agent can stall its track.
- **Automatic re-dispatch** — one retry on transient failure; quota errors skip it.
- **Explicit failure propagation** — failed agents are marked `failed: true` and
  *removed* from fan-in, rather than passing `"(this agent failed)"` downstream as
  though it were content. The aggregating agent is told honestly how many inputs
  are missing.
- **Model failover chain** — a call that exhausts one model's quota automatically
  falls to the next.
- **Circuit breaker** — a rate-limited model is skipped for a 60s cooldown instead
  of being re-dialled by every subsequent agent.

### 1.5 Typed handoffs

Workers do not hand raw prose to the Synthesizer. Each appends a confidence
declaration (`high` / `medium` / `low` plus a caveat), which is parsed out and
passed to the Synthesizer as metadata. The Synthesizer is instructed to lean on
high-confidence findings and hedge or drop low-confidence claims. This turns
fan-in from concatenation into **weighted** aggregation.

---

## 2. Architecture

### 2.1 Design principle: one protocol, many topologies

The central architectural decision is that **every topology emits the same event
stream**. The backend does not know about UI; the frontend does not know about
patterns.

```
POST /api/research  { question, pattern, critic, web, compare }
        │
        ▼
   runTrack(pattern)         ← selects topology; "auto" inserts a meta-router first
        │
        ├─ nodeRun(...)      ← supervisor wrapper: timeout, retry, telemetry, failure flag
        │      └── emits: node → node_retry? → node_done
        │
        └─ emits: final { answer, sources, stats }

   compare mode → two tracks (A, B) run concurrently → runJudge → verdict
```

Server-Sent Events carry a small, generic vocabulary:

| Event | Meaning |
|---|---|
| `track` | A new execution track opened (A = pattern, B = baseline) |
| `track_label` | Track renamed (used by Auto: `Auto → Self-consistency`) |
| `node` | An agent started |
| `node_retry` | An agent failed and is being re-dispatched |
| `node_done` | An agent finished — carries result, sources, ms, tokens, model, failed, confidence |
| `final` | A track produced its answer + aggregate stats |
| `judging` / `verdict` | Evaluation in progress / scores in |

**Consequence:** adding a seventh topology requires no UI work at all. The renderer
draws whatever nodes arrive. This is what makes the lab cheap to extend, and it is
the property to preserve as the system grows.

### 2.2 Supervisor pattern

`nodeRun()` is the single choke point through which every agent invocation passes.
Timeout, retry, telemetry, and failure semantics live there rather than being
scattered across six topology implementations. Any future concern — cost caps,
per-agent tracing, caching, human-in-the-loop approval — attaches at this one
function.

### 2.3 Deliberate non-choices

- **No agent framework** (no LangChain / CrewAI / AutoGen). The patterns are the
  product; a framework would hide exactly the thing being studied.
- **No runtime dependencies** beyond Next.js and React. `undici` is used only to
  route through a local dev proxy.
- **No database yet.** State is per-request. This is the most significant gap for
  productisation (see §4.1).

---

## 3. Business scenarios

The measurement layer — not the patterns — is the defensible asset. Four routes
to market, ordered by how directly they exploit it.

### 3.1 Scenario A — "Which pattern should I use?" (developer tool)

**Problem.** Teams building agent products choose a topology by intuition, then
discover in production that it is 5× the cost for no quality gain. There is no
cheap way to answer *"is multi-agent worth it for my task?"*

**Product.** Paste your task → AgentShip runs it through every topology → returns a
ranked table of quality score, latency, and token cost. A decision, not a vibe.

**Why it fits.** This is the current codebase with a batch-runner on top. Nothing
in §1 is wasted.

**Monetisation.** Free tier with a handful of runs/day; paid tier for bulk runs,
custom task suites, and CI integration.

**Risk.** The market is developers, who are notoriously reluctant to pay for tools
they could build. Mitigated by the eval corpus (§3.2) being the real moat.

### 3.2 Scenario B — Agent evaluation as a service *(strongest long-term)*

**Problem.** Everyone shipping an LLM feature faces the same question — *did that
prompt/model/topology change make things better or worse?* — and answers it by
eyeballing a handful of outputs.

**Product.** Bring your own agent (via API endpoint). AgentShip runs your task
suite against it, blind-judges outputs against a baseline or a previous version,
and reports regressions. Effectively **CI for agent quality**.

**Why it fits.** The blind position-swapped judge, per-run telemetry, and A/B track
machinery already exist. The pivot is *whose* agents get evaluated — ours or the
customer's.

**Monetisation.** Per-evaluation pricing or seat-based SaaS. Natural expansion into
regression dashboards and alerting.

**Risk.** LLM-as-judge reliability is itself contested. Mitigation is already
partially built (position swapping, multi-dimension rubric); the next steps are
human-labelled calibration sets and inter-judge agreement metrics.

### 3.3 Scenario C — Quality-tier API

**Problem.** Application developers want "give me a better answer" without designing
an agent system.

**Product.** An OpenAI-compatible endpoint with a `quality` parameter:
`fast` (single call) · `balanced` (router/orchestrator) · `best` (debate + critic).
One integration, tunable cost/quality per request.

**Why it fits.** Auto mode is already a working quality-tier dispatcher.

**Monetisation.** Usage-based margin over raw model cost.

**Risk.** Competing directly with model providers on their own turf; margin
compresses as base models improve. Best treated as a distribution channel for
A/B rather than the core business.

### 3.4 Scenario D — Open-source + education

**Product.** The repo itself: a readable, framework-free reference implementation of
six agent topologies with live visualisation. The live demo is genuinely
compelling — watching agents fan out, fail, retry, and get judged.

**Why it fits.** Zero additional work; it *is* the repo. Serves as top-of-funnel for
A/B and as credibility for a technical audience.

**Monetisation.** Indirect — audience, hiring signal, inbound for paid tiers.

### 3.5 Recommended sequencing

```
Now ──────────► D (open source, live demo)     credibility + audience, zero extra cost
   │
   └──► A (pattern chooser)  ─────────────────► first paid surface, closest to current code
              │
              └──► B (eval-as-a-service) ─────► the durable business
                          │
                          └──► C (quality API)  distribution, opportunistic
```

**Domain split:** `agentship.online` = the product/app · `agentship.space` = the
open lab, docs, and public benchmark results.

---

## 4. Gaps between lab and product

Honest inventory. These are what stand between the current state and Scenario A/B.

### 4.1 Blocking (needed for any paid product)

| Gap | Why it blocks | Effort |
|---|---|---|
| **No persistence** | Cannot show run history, share results, or track regressions over time — the entire value of B | Medium |
| **No auth / rate limiting** | Cannot expose publicly without unbounded cost | Medium |
| **No key management** | Currently one server-side key; a real product needs per-tenant keys and quotas | Medium |
| **Single provider** | Locked to Gemini free tier; free-tier quota (20–250 req/day) is exhausted by ~2 hours of testing | Low–Medium |

### 4.2 Scientific credibility (needed for B to be trusted)

- **Judge calibration** — no human-labelled ground truth yet, so judge accuracy is
  unmeasured. Position bias is handled; verbosity bias and self-preference are not.
- **N=1 conclusions** — each run is a single sample. Needs repeated trials with
  variance reporting before any claim like "debate beats orchestrator" is defensible.
- **No task corpus** — needs a fixed, categorised benchmark suite (reasoning,
  synthesis, judgement, generation) so patterns are compared on level ground.

### 4.3 Remaining architectural work

- **Hierarchical decomposition** — a worker cannot spawn its own sub-team; depth is
  hard-coded at one level.
- **Shared blackboard** — parallel workers are fully blind to each other, so
  overlapping sub-tasks duplicate effort that the Synthesizer then pays to dedupe.
- **Context economics** — the Synthesizer receives every worker output verbatim;
  large fan-outs will blow the context budget. Needs compression between stages.
- **Tool-augmented specialists** — the code specialist writes code it cannot run.
  Generate → execute → repair loops are where specialists earn their cost.
- **Budget steering** — token stats are collected but not used to cap or allocate
  spend mid-run.

---

## 5. What the lab has actually shown so far

Early, low-N, and worth stating plainly rather than overselling:

1. **Multi-agent is not free quality.** On a simple advice task, the single-agent
   baseline scored **30.0/30 against the Orchestrator's 25.0**. Decomposition added
   4× the cost and *lost*. This is the most commercially important finding in the
   project: it is precisely why Scenario A/B has a market.
2. **Pattern fit is task-dependent.** The meta-router independently selected
   Self-consistency for arithmetic and Debate-class handling for judgement
   questions — matching the theoretical expectation without being told the answer.
3. **Iterative critique works where single-pass critique does not.** On a
   constrained-format task, round 1 caught a 44-word answer against a 40-word limit;
   the revision came back at 46 words; **round 2 caught it again** and the final
   output complied. A single critic pass would have shipped the violation.
4. **Self-consistency converges.** 4/4 independent samples agreed on the correct
   arithmetic result, and the Aggregator reported unanimity rather than parroting
   one sample.

---

## 6. Recommended next steps

**Immediate (unblocks everything):**
1. Move off the free tier or add a second provider — quota exhaustion currently
   caps all experimentation at roughly two hours per day.
2. Add persistence (runs, verdicts, stats). Without it there is no product in A or B.

**Near term (makes the thesis defensible):**
3. Build a fixed task corpus, categorised by task shape.
4. Run each pattern × task N times; report means and variance instead of single runs.
5. Publish the resulting benchmark on `agentship.space` — this is the marketing
   asset *and* the scientific contribution.

**Then (productisation):**
6. Auth + per-tenant keys → open Scenario A publicly.
7. "Bring your own agent" endpoint → Scenario B.

---

## 7. Assessment

The project's genuine asset is **not** the six topologies — those are reproducible
by anyone in a weekend. It is the **measurement harness**: blind position-swapped
judging, per-agent cost telemetry, and side-by-side baseline comparison, all
wrapped in an architecture where adding a topology costs no UI work.

The industry is currently long on agent frameworks and short on evidence that
agent complexity pays for itself. AgentShip is positioned on the evidence side of
that gap. The finding that a single call sometimes beats a four-agent pipeline is
not a setback for the project — it is the product.

---

*Report generated 2026-07-27. Reflects commit `b3fc540`.*
