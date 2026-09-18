# ✦ AgentShip Verify — Evidence-Based Preflight for Agent Code

[![Next.js](https://img.shields.io/badge/Next.js-16.2_(App_Router)-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)

**AgentShip Verify** independently checks agent-written changes and records reproducible evidence before you commit or merge them. It is designed for developers using tools such as **Claude Code**, **Codex**, **Cursor**, **OpenCode**, and **Pi**.

The core rule is simple: an agent's statement that tests passed is a claim, not evidence. AgentShip runs configured checks itself and binds their results to the exact task and Git state reviewed.

---

## 🌟 Why AgentShip?

Terminal coding agents excel at speed and autonomous execution, but present three critical bottlenecks in real-world workflows:

1. **Terminal Inspection Limits**: Reviewing large, multi-file Git diffs and complex execution branches in a terminal TUI is cumbersome and error-prone.
2. **Single-Model Blind Spots**: An agent that writes code is prone to confirmation bias when self-evaluating; bugs, subtle race conditions, and security risks slip through.
3. **Intent Drift**: Agents may omit a requirement or modify unrelated files while still reporting the task complete.

```
┌─────────────────────────────────────────────────────────────┐
│                 CLI Coding Agent Sources                    │
│    (Claude Code / DeepSeek Harness / OpenCode / Pi)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (SSE / REST / MCP)
┌──────────────────────────────┴──────────────────────────────┐
│                     AgentShip Verify                       │
│                                                             │
│  ✅ Executed Checks     🔍 Preflight Diff                    │
│  🧾 Evidence Manifest   🎯 Task Requirements                │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Features

### 1. 🔍 Interactive Visual Diff Review
- **Multi-File Inspector**: Parses Git Unified Diffs into interactive file cards with additions/deletions badges.
- **Dual View Modes**: Seamlessly toggle between **Unified** (inline) and **Split** (side-by-side) diffs.
- **Fast File Jump & Stats**: Overview counters for total files changed, lines added (`+`), and lines removed (`-`).
- **Language Detection**: Automatic syntax coloring for 18+ programming languages.

### 2. 🛡️ Cross-Model Quality & Security Audit Gate
- **Independent Cross-Examination**: Sends code changes or diffs to an independent Auditor LLM (e.g. Gemini 3.8 Flash / DeepSeek V4 / Claude 5).
- **Four-Dimensional Rigorous Rubric**:
  - 🛡️ **Security**: SQL/XSS/Command injection, credential leaks, path traversal, auth flaws.
  - ⚙️ **Correctness**: Null pointer dereferences, unhandled promise rejections, race conditions, edge cases.
  - 🧪 **Test Coverage**: Verifies whether unit tests were added and regressions are prevented.
  - 🧹 **Maintainability**: Cyclomatic complexity, code clarity, antipatterns.
- **Actionable Findings**: Categorized by `BLOCKER`, `WARNING`, and `NITPICK` with code snippets and **copyable fix patches**.

### 3. 🧭 Experimental Model Lab
The existing research surface can compare model topologies, but it is experimental and is not part of the trusted verification verdict:
- 🧭 **Orchestrator**: Planner → Parallel Workers (with typed confidence handoffs) → Synthesizer.
- 💬 **Debate**: 3 Debaters (pragmatic, skeptical, creative) → Cross-Rebuttal round → Judge ruling.
- 🚦 **Router**: Intent classification → Specialized domain agent (Code, Writing, Analysis, General).
- 🗳️ **Self-Consistency**: 4 independent high-temperature reasoning samples → Consensus voting.
- 🤖 **Single (Baseline)**: One model, one call — control group.
- 🕵️ **Critic Reflection**: Multi-round structured review with automated revision loop.
- ⚖️ **Double-Blind Pairwise Judge**: Position-swapped automated scoring to eliminate position bias.

### 4. 📊 Run History
- Tracks wall-clock time, token usage, net code volume delta, and average quality scores.
- Session execution log table for cost attribution and performance benchmarking.

---

## 📁 Project Structure

```
agentship/
├── docs/
│   ├── TECHNICAL_REPORT.md       # Technical report, architecture & business scenarios
│   └── INTEGRATION_GUIDE.md      # Integration guide for Claude Code, Pi & DSH
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── audit/route.ts    # Cross-Model Quality & Security Audit API
│   │   │   └── research/route.ts # Multi-Agent Topologies Orchestration API
│   │   ├── globals.css           # Tailwind CSS v4 & custom keyframe styling
│   │   ├── layout.tsx            # Global metadata and RootLayout
│   │   └── page.tsx              # AgentShip Multi-Tab Mission Control UI
│   ├── components/
│   │   ├── audit/
│   │   │   ├── AuditReportCard.tsx # Detailed audit report card & fix patches
│   │   │   └── SeverityBadge.tsx   # Blocker / Warning / Nitpick badges
│   │   ├── diff/
│   │   │   ├── DiffFileCard.tsx    # Single-file unified & split diff renderer
│   │   │   └── DiffViewer.tsx      # Multi-file visual diff container & toolbar
│   │   ├── telemetry/
│   │   │   └── RoiDashboard.tsx    # ROI, cost, latency, and session log table
│   │   └── index.ts              # Component exports
│   ├── lib/
│   │   ├── diff-parser.ts        # Git Unified Diff parsing engine
│   │   └── prompts/
│   │       └── audit.ts          # Auditor system prompts and JSON schemas
│   ├── types/
│   │   ├── agent.ts              # Agent state, track, and telemetry types
│   │   ├── audit.ts              # Audit issue, scores, and report types
│   │   ├── diff.ts               # Diff file, hunk, and line types
│   │   └── index.ts              # Type exports
│   └── instrumentation.ts        # Outbound proxy dispatcher (undici)
└── package.json
```

---

## 🚀 Quickstart

### 1. Installation

```bash
git clone https://github.com/hasak21/agentship.git
cd agentship
npm install
```

### 2. Universal Environment Configuration

Create a `.env.local` file in the project root with any of your preferred model providers:

```env
# --- Option A: DeepSeek (Recommended for high speed & reasoning) ---
DEEPSEEK_API_KEY=your-deepseek-api-key
# DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
# DEEPSEEK_MODEL=deepseek-flash

# --- Option B: OpenAI / OpenRouter / Generic OpenAI-Compatible ---
OPENAI_API_KEY=your-openai-or-openrouter-key
# OPENAI_BASE_URL=https://openrouter.ai/api/v1
# OPENAI_MODEL=gpt-6-astra

# --- Option C: Anthropic Claude ---
ANTHROPIC_API_KEY=your-anthropic-api-key
# ANTHROPIC_MODEL=claude-sonnet-5

# --- Option D: Local / Self-Hosted (Ollama / vLLM) ---
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_MODEL=qwen3-coder:30b

# --- Option E: Google Gemini (Optional) ---
# GEMINI_API_KEY=your-gemini-key
# GEMINI_MODEL=gemini-3.8-flash

# Optional Proxy
# HTTPS_PROXY=http://127.0.0.1:7890

# Required as a Bearer token when exposing AgentShip beyond localhost
# AGENTSHIP_API_TOKEN=replace-with-a-long-random-value

# Optional outbound provider request deadline (default: 30000)
# LLM_REQUEST_TIMEOUT_MS=30000
```

### 3. Run Development Server & Tests

```bash
# Run unit tests
npm test

# Start the optional AgentShip Verify web interface
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run the evidence-based preflight

From a source checkout:

```bash
npm run review -- --task task.md
```

Task requirements may opt into explicit operator confirmation with a `[confirm]`
prefix. Supply their stable IDs when reviewing:

```markdown
## Requirements

1. [confirm] Rotate the production signing key.
```

```bash
npm run review -- --task task.md --confirm R1
```

The confirmation is recorded evidence, not authenticated approval or a signature.
Requirements mapped to `.agentship.yml` protected paths with
`requireManualApproval: true` also require confirmation automatically.

Requirements can bind expected files and configured checks to the report with
`` `change:path` ``, `` `check:name` ``, and `` `symbol:path#identifier` ``
annotations. Every annotation must be
observed; these annotations prove coverage of named evidence, not semantic correctness.
AgentShip also emits explicitly labeled, non-blocking inferred warnings when prose
requests tests or documentation but no changed file has that role.

Add `<!-- agentship: strict-change-coverage -->` to a task when every changed
implementation file must be covered by an explicit `` `change:path` `` annotation.
Unattributed files then produce a warning, not an unsupported claim that they are unrelated.

Build and verify the standalone Node 20 CLI artifact:

```bash
npm run verify:cli
node dist/agentship.cjs review --task task.md
```

The review writes JSON, Markdown, and SARIF evidence under `.agentship/reviews/`.

Compare a review with a previous AgentShip JSON report:

```bash
npm run review -- --task task.md --baseline .agentship/baselines/main.json
```

The report classifies exact finding ID/kind pairs as new, existing, or resolved and
binds the comparison to the baseline SHA-256, run ID, and commit. Baselines are bounded,
parsed as data, and never change the current verdict. Selecting and retaining the right
baseline remains an operator or CI responsibility.

Checks may declare `whenChanged` with exact repository paths or trailing `/**`
directory patterns. A check with no matching changed path is recorded as `skipped`;
an explicit `` `check:name` `` requirement still treats that status as unsatisfied.
Repository-owned `limits.maxChangedFiles` and `limits.maxDiffBytes` stop command
execution and emit blockers before an oversized review runs. Per-check timeouts and the
workflow timeout provide wall-clock bounds; CPU, memory, process, and network isolation
remain future maintainer-mode controls.

Known warning findings can be suppressed by an exact finding ID and kind under
`policy.suppressions`. Every suppression requires a stable suppression ID, owner, reason,
and `YYYY-MM-DD` expiry. Suppressions cannot target blocker kinds, never delete evidence,
and are emitted in JSON, Markdown, and SARIF. In fork CI the policy comes from the trusted
base revision; a local policy edited in the reviewed patch is not an immutable approval.

Run the checked-in omission calibration corpus, or supply another compatible corpus:

```bash
npm run benchmark:intent
node dist/agentship.cjs benchmark --fixtures fixtures/intent/executable-patch-corpus.json
```

Benchmark JSON includes the corpus SHA-256, confusion-matrix metrics, and per-case
results. The primary 12-case corpus applies declarative in-memory patches and evaluates
safe file oracles; it never executes corpus commands. It remains a synthetic regression
baseline, not a claim of representative real-world accuracy. The earlier metadata-only
scenario suite remains available through `npm run benchmark:intent:scenarios`.

### 5. GitHub pull-request report mode

The checked-in `.github/workflows/agentship-report.yml` runs on `pull_request` with
read-only permissions and no secrets. It builds AgentShip and loads policy from the base
commit, reviews the subject in a separate checkout, and uploads JSON/Markdown evidence as
an artifact. It also publishes the Markdown report to the workflow job summary and includes
SARIF in the artifact. Keep it on GitHub-hosted runners and do not enable write tokens or secrets for
fork workflows. This initial workflow reports evidence only; it does not comment, publish
a Check Run, or block merging. See `docs/CI_REPORT_MODE.md` for the trust boundary.

---

## 📡 API Reference & Model Context Protocol (MCP)

### `POST /api/mcp` (Model Context Protocol JSON-RPC 2.0)
Standard MCP server supporting tools (`audit_diff`, `inspect_diff`, `run_multiagent_topology`, `get_telemetry_summary`) and resources (`agentship://guidelines/audit_rubric`, `agentship://topologies/catalog`).

**Connect via Claude Code:**
```bash
claude mcp add agentship http://localhost:3000/api/mcp
```

**Connect via Cursor (.cursor/mcp.json):**
```json
{
  "mcpServers": {
    "agentship": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

### `POST /api/audit`
Audits a Git Unified Diff or code change payload across security, correctness, testing, and maintainability.

**Request:**
```json
{
  "diff": "diff --git a/file.ts b/file.ts\n...",
  "context": "Feature implementation description",
  "model": "deepseek-flash",
  "provider": "deepseek"
}
```

**Response:**
```json
{
  "id": "audit-1740870000000-xyz",
  "auditorModel": "deepseek-flash",
  "auditorProvider": "deepseek",
  "overallScore": 92,
  "passed": true,
  "summary": "Implementation is robust with good test coverage.",
  "scores": {
    "security": { "score": 9.5, "comment": "No vulnerabilities found." },
    "correctness": { "score": 9.0, "comment": "Logic handles edge cases properly." },
    "testCoverage": { "score": 9.0, "comment": "Unit tests cover boundary conditions." },
    "maintainability": { "score": 9.5, "comment": "Clean modular code." }
  },
  "issues": [
    {
      "id": "issue-1",
      "category": "maintainability",
      "severity": "nitpick",
      "title": "Unused import",
      "description": "Consider removing unused import at top of file.",
      "file": "file.ts",
      "line": 3,
      "suggestion": "Remove import { useState } from 'react'",
      "fixPatch": "@@ -3,1 +3,0 @@\n-import { useState } from 'react';"
    }
  ],
  "tokens": 850,
  "ms": 1420
}
```

### `POST /api/research`
Executes tasks through multi-agent topologies (Orchestrator, Debate, Router, Self-Consistency, Single Baseline, Auto) and streams SSE execution events.

---

## 🛣️ Roadmap

- [x] **Sprint 1 (Delivered)**:
  - [x] Multi-file Git Unified Diff Parser & Visual Diff Viewer (Unified & Split modes).
  - [x] Cross-Model Quality & Security Audit Gate with 4-dimension scoring & auto-patch.
  - [x] Telemetry ROI dashboard and session execution log.
  - [x] AgentShip multi-tab mission control UI.
- [x] **Sprint 2 (Delivered)**:
  - [x] Universal LLM Provider Engine (DeepSeek V4.1/V4 Pro, Claude 5 family, GPT-6 Astra/GPT-5.6 Terra, Qwen3-Coder via Ollama, Gemini 3.8 Flash).
  - [x] Decoupled from any single model vendor; universal OpenAI-compatible + Anthropic protocol support.
  - [x] Standard Model Context Protocol (MCP) Server endpoint (`/api/mcp`) for native Claude Code & Cursor integration.
  - [x] Pi coding agent plugin extension (`extensions/pi-agentship.ts`).
  - [x] Multi-model selector in mission control workbench.
  - [x] Comprehensive unit test suite with `tsx --test`.
- [ ] **Sprint 3 (Upcoming)**:
  - [ ] Persistent storage (Supabase / SQLite) for team audit history & trend regression.
  - [ ] Automated Git PR Webhook triggers.

---

## 📄 License

MIT © [AgentShip Team](https://github.com/hasak21/agentship)
