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

Protected-path policy also evaluates the complete observed changed-file set, even when a
task omits path annotations. Approve each matching configured pattern explicitly:

```bash
npm run review -- --task task.md --approve-path 'src/payments/**'
```

`--approve-path` is repeatable and must exactly match a configured pattern whose
`requireManualApproval` value is true. Unknown approvals are rejected. The report records
the pattern, every matching file, the approval state, and the reviewed diff hash. This is
a local operator assertion rather than authenticated identity; task-level confirmation is
still separately required when an explicit requirement maps to the protected path.

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
JSON and Markdown bind the canonical AgentShip entrypoint path, byte length, and SHA-256.
For the standalone CLI and official CI, this is the exact self-contained bundle; source
mode honestly identifies only the TypeScript entrypoint, not every imported module. JSON
and Markdown also include the canonical host Git executable, bounded version string,
exact byte length, and SHA-256; AgentShip refuses repository-controlled and
`node_modules/.bin` Git replacements before calculating the reviewed head or diff and
fails closed if the Git provenance changes during review. The digest identifies executable
bytes but does not authenticate the host administrator, OS package, or Git vendor.

Optionally sign the exact JSON report with an Ed25519 private key stored outside the
reviewed repository:

```bash
openssl genpkey -algorithm Ed25519 -out ../agentship-signing-key.pem
chmod 600 ../agentship-signing-key.pem
openssl pkey -in ../agentship-signing-key.pem -pubout -out ../agentship-signing-public.pem

npm run review -- --task task.md \
  --output .agentship/reviews/latest.json \
  --signing-key ../agentship-signing-key.pem
node dist/agentship.cjs verify-signature \
  --report .agentship/reviews/latest.json \
  --signature .agentship/reviews/latest.sig.json \
  --public-key ../agentship-signing-public.pem
```

Verification requires the separately trusted public key; a key embedded beside an
untrusted report is not authority. See `docs/EVIDENCE_SIGNATURES.md` for key and CI
boundaries.

Compare a review with a previous AgentShip JSON report:

```bash
npm run review -- --task task.md --baseline .agentship/baselines/main.json
```

The report classifies exact finding ID/kind pairs as new, existing, or resolved and
binds the comparison to the baseline SHA-256, run ID, and commit. Baselines are bounded,
parsed as data, and never change the current verdict. Selecting and retaining the right
explicit baseline remains an operator responsibility.

For repeated local reviews of the same task and policy, enable durable history:

```bash
npm run review -- --task task.md --history .agentship/history
```

Each run records JSON, Markdown, and SARIF under the ignored history directory. Before
the new report is written, AgentShip automatically selects the newest compatible JSON
report as its baseline. Compatibility requires the same configuration SHA-256, task
SHA-256 (including both having no task), review scope, and base reference. Newer reports
from other tasks or policies are skipped. History is limited to 1,000 directory entries,
individual reports retain the 5 MiB bound, malformed history fails closed, and the
selected baseline remains informational—it cannot change the current verdict. An explicit
`--baseline` takes precedence while the run is still recorded to history.

The checked-in GitHub workflows restore the latest publisher-validated report for the
same PR through a read-only cache, then save the newly validated report from the separate
write-only publisher. Cache misses and incompatible task/policy/base contexts fall back
to a history-free review, and baseline comparison never changes the verdict. See
`docs/CI_REPORT_MODE.md` for cache-poisoning and provenance boundaries.

Checks may declare `whenChanged` with exact repository paths or trailing `/**`
directory patterns. A check with no matching changed path is recorded as `skipped`;
an explicit `` `check:name` `` requirement still treats that status as unsatisfied.
Repository-owned `limits.maxChangedFiles` and `limits.maxDiffBytes` stop command
execution and emit blockers before an oversized review runs. `limits.maxCheckSeconds`
sets a cumulative wall-clock deadline across check preparation and execution: AgentShip
clamps the active check to the remaining time, stops starting later applicable checks, and
emits a blocker when exhausted. Per-check and outer workflow timeouts remain independent
defense-in-depth bounds. Process termination still has a one-second forced-kill grace and
sandbox cleanup may finish after the deadline; the report records actual elapsed time. On
Linux, a check may also request kernel resource limits:

```yaml
checks:
  - name: test
    run: npm test
    timeoutSeconds: 120
    resources:
      cpuSeconds: 120
      memoryMiB: 2048
      maxFileSizeMiB: 64
      maxOpenFiles: 1024
```

AgentShip executes such checks through `/usr/bin/prlimit` and records the backend and
configured values in the report. The configuration fails closed without that Linux
backend. Kernel limits apply to each process and are inherited by children; the cumulative
wall deadline is aggregate time, not aggregate CPU, memory, process-count, or disk-capacity
accounting, network control, or filesystem isolation.
`memoryMiB` is an address-space limit, not an RSS or container-memory limit, and modern
JavaScript/Wasm runtimes may reserve far more virtual memory than they physically use.
The portable local `.agentship.yml` therefore remains unrestricted. The official Ubuntu
workflow uses the base-owned `.agentship.ci.yml` for CPU, file-size, and open-file bounds,
but does not claim a reliable memory bound for its Node-based checks.

Linux users with `/usr/bin/bwrap` may opt a check into a disposable worker:

```yaml
checks:
  - name: test
    run: npm test
    isolation: bubblewrap
    network: denied
```

The worker copies Git-tracked and non-ignored untracked files without `.git`, `.agentship`, or `node_modules`, mounts
the copied workspace writable, mounts `node_modules` and the minimal system/Node runtime
read-only, creates fresh `/tmp` and home directories, and discards the copy afterward.
Network is denied unless the trusted policy explicitly says `network: allowed`. Workspace
copying is bounded to 200,000 entries and 2 GiB. Unsupported platforms or a missing
backend fail closed. This is meaningful host-file, mutation, PID, and network namespace
isolation, but not a VM or a defense against kernel vulnerabilities. See
`docs/ISOLATED_CHECKS.md` for exact boundaries.

Every checked-in AgentShip policy now declares `network: denied` for every check. The web
UI uses pinned, SIL-OFL-licensed local Geist assets, so the production build no longer
fetches Google Fonts. Dependency installation remains a separate pre-check network phase.

This repository dogfoods the backend with:

```bash
npm run review -- --config .agentship.bubblewrap.yml --task task.md
```

Known warning findings can be suppressed by an exact finding ID and kind under
`policy.suppressions`. Every suppression requires a stable suppression ID, owner, reason,
and `YYYY-MM-DD` expiry. Suppressions cannot target blocker kinds, never delete evidence,
and are emitted in JSON, Markdown, and SARIF. In fork CI the policy comes from the trusted
base revision; a local policy edited in the reviewed patch is not an immutable approval.

Repository policy can promote supported finding kinds to blockers with `policy.blockOn`:

```yaml
policy:
  blockOn:
    - explicit_requirement_path_unchanged
    - explicit_requirement_evidence_unsatisfied
```

Unknown and duplicate kinds are rejected. Promotion happens before suppressions, so a
configured blocker cannot be hidden by a warning suppression. Required-check failures,
repository mutation, exceeded review budgets, and missing required confirmation remain
core integrity blockers even when they are omitted from `blockOn`. The JSON and Markdown
reports record the configured promotion list. In report mode, `BLOCK` is evidence but does
not make the process exit nonzero; gate mode enforces it.

Exceptional human decisions use a separate, hash-bound override record. First produce the
unmodified report, then create a bounded JSON record that references its exact SHA-256:

```json
{
  "schemaVersion": 1,
  "id": "release-exception-42",
  "actor": "release-manager@example.com",
  "reason": "Known upstream outage; rollback owner is on call.",
  "expiresAt": "2026-10-01",
  "report": {
    "path": ".agentship/reviews/pre-override.json",
    "sha256": "<64 lowercase hex characters>"
  },
  "findings": [
    { "id": "check-1", "kind": "required_check_failed" }
  ]
}
```

```bash
sha256sum .agentship/reviews/pre-override.json
npm run review -- --task task.md --override .agentship/overrides/release-42.json
```

The referenced report must match the current head, diff, configuration, and task hashes,
and each target must exist in both reviews. Actor, reason, expiry, record hash, source
report hash, and targets are retained in JSON, Markdown, and SARIF. Actor identity is not
authenticated yet. See `docs/OVERRIDES.md` for the threat boundary and non-overrideable
integrity findings.

Record the later disposition of an exact finding for calibration:

```bash
node dist/agentship.cjs outcome \
  --report .agentship/reviews/review.json \
  --finding-id check-1 \
  --finding-kind required_check_failed \
  --status accepted \
  --actor maintainer@example.com \
  --reason "Reproduced locally."
```

Supported outcomes are `accepted`, `rejected`, `fixed`, and `overridden`. Fixed outcomes
also require `--resolution-report` and prove that a compatible, newer changed-state report
no longer contains the exact finding identity. Overridden outcomes require retained override
evidence. Records are hash-bound, bounded, exclusively created under the ignored
`.agentship/outcomes` directory, and retain triage duration. Actor identity remains an
unauthenticated claim. See `docs/OUTCOMES.md` for evidence semantics and storage limits.

Aggregate review denominators, finding outcomes, and a freshly executed omission corpus:

```bash
npm run metrics -- \
  --outcomes .agentship/outcomes \
  --reports .agentship/history \
  --benchmark-fixtures fixtures/intent/executable-patch-corpus.json
```

The resulting hash-bound JSON reports finding and blocker precision, omission recall,
false blocks per 100 reviews, median triage time, override rate, and post-override
outcomes. It fails closed when an outcome's report is missing or tampered, a fixed finding
still exists, or human dispositions conflict. Metrics retain sample sizes and return
`null` for precision without an adjudicated denominator. See `docs/CALIBRATION.md` for
formulas and provenance limits.

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
SARIF in the artifact. A separate trusted `workflow_run` publisher downloads that artifact
as untrusted data, validates the bounded report and event bindings, and creates an
always-neutral Check Run on the pull-request head. Keep the subject workflow on
GitHub-hosted runners and do not enable write tokens or secrets for fork workflows. The
publisher never executes artifact contents and does not comment, label, or block merging.
Reports hash the exact AgentShip entrypoint, Git executable, and launching Node executable and record
bounded OS and GitHub runner-image metadata. The publisher requires the expected
GitHub-hosted Linux X64 shape and includes the image/runtime identity in its neutral
summary. This is recorded provenance, not authenticated runner or workload attestation.
Do not configure the neutral `AgentShip evidence report` Check Run as a required check.
See `docs/CI_REPORT_MODE.md` for the trust boundary.

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
