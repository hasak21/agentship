# ✦ AgentShip — Multi-Agent Lab

Run any task through different **multi-agent patterns** and watch a team of
ordinary models outthink a single call — live, with per-agent timing and token
stats so you can measure the difference, not just feel it.

> The point: every agent uses the **same ordinary model** (Gemini Flash).
> Whatever quality you gain comes from the *pattern*, not a bigger model.

## Patterns

| Pattern | Flow |
|---|---|
| 🧭 **Orchestrator** | Planner → parallel Workers → Synthesizer |
| 💬 **Debate** | 3 debaters (pragmatic / skeptical / creative) → rebuttal round (each attacks the others' weak points) → Judge rules on the full transcript |
| 🚦 **Router** | Router classifies the task → routes to a Specialist |
| 🤖 **Single** | One model, one call — the baseline |

Stackable add-ons:

- 🕵️ **Critic pass** — a Critic reviews the draft, a Reviser applies the feedback
- 🌐 **Web search** — live Google Search grounding with cited sources
- ⚖️ **Compare vs single** — run your pattern *and* the single-agent baseline
  side-by-side, with time / calls / tokens for each

## How it works

- **Backend** — one Next.js route handler (`src/app/api/research/route.ts`)
  orchestrates all agents and streams generic *node events* over SSE:
  `track` → `node` → `node_done` (with ms + tokens) → `final` (with track stats).
- **Frontend** — one renderer (`src/app/page.tsx`) draws any pattern from that
  event stream: live agent cards with status, expandable results, sources, and
  a stats summary per track.
- No agent framework, no extra dependencies — plain `fetch` calls arranged in
  patterns, which is the whole point.

## Run it

```bash
npm install
npm run dev                        # → http://localhost:3000
```

Create `.env.local` in the project root:

```
GEMINI_API_KEY=your-key-from-aistudio.google.com
```

Notes:

- Web search uses `gemini-2.5-flash` (grounding is reliable there); everything
  else uses `gemini-flash-latest`.
- On the free tier, parallel agents can hit the per-minute quota; calls retry
  automatically with backoff, and rate-limited agents say so in the UI.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Google Gemini API

---

Built as part of the **AgentShip** project (agentship.online).
