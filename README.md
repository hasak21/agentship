# ✦ AgentShip 2.0 — Coding Agent Mission Control & Cross-Audit Gate

[![Next.js](https://img.shields.io/badge/Next.js-16.2_(App_Router)-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)

**AgentShip 2.0** is an open-source **Visual Mission Control and Multi-Model Quality & Security Audit Gate** designed for CLI-first AI coding agents (such as **Claude Code**, **DeepSeek Harness (dsh)**, **OpenCode**, and **Pi**).

Rather than reinventing another monolithic code generation CLI, AgentShip acts as an **ecosystem companion (Layer-2)** that bridges the gap between terminal agents and developer experience.

---

## 🌟 Why AgentShip 2.0?

Terminal coding agents excel at speed and autonomous execution, but present three critical bottlenecks in real-world workflows:

1. **Terminal Inspection Limits**: Reviewing large, multi-file Git diffs and complex execution branches in a terminal TUI is cumbersome and error-prone.
2. **Single-Model Blind Spots**: An agent that writes code is prone to confirmation bias when self-evaluating; bugs, subtle race conditions, and security risks slip through.
3. **Lack of Attribution & ROI Metrics**: Engineering teams lack real-time visibility into agent task duration, token costs, lines modified, and code quality benchmarks.

```
┌─────────────────────────────────────────────────────────────┐
│                 CLI Coding Agent Sources                    │
│    (Claude Code / DeepSeek Harness / OpenCode / Pi)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (SSE / REST / MCP)
┌──────────────────────────────┴──────────────────────────────┐
│                      AgentShip 2.0                          │
│                                                             │
│  🧭 Multi-Agent Lab     🔍 Visual Diff Review               │
│  🛡️ Cross-Audit Gate    📊 Telemetry & ROI Dashboard        │
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
- **Independent Cross-Examination**: Sends code changes or diffs to an independent Auditor LLM (e.g. Gemini 2.5 Pro / DeepSeek / Claude).
- **Four-Dimensional Rigorous Rubric**:
  - 🛡️ **Security**: SQL/XSS/Command injection, credential leaks, path traversal, auth flaws.
  - ⚙️ **Correctness**: Null pointer dereferences, unhandled promise rejections, race conditions, edge cases.
  - 🧪 **Test Coverage**: Verifies whether unit tests were added and regressions are prevented.
  - 🧹 **Maintainability**: Cyclomatic complexity, code clarity, antipatterns.
- **Actionable Findings**: Categorized by `BLOCKER`, `WARNING`, and `NITPICK` with code snippets and **copyable fix patches**.

### 3. 🧭 Multi-Agent Orchestration Lab
Run tasks through multiple multi-agent topologies and compare performance:
- 🧭 **Orchestrator**: Planner → Parallel Workers (with typed confidence handoffs) → Synthesizer.
- 💬 **Debate**: 3 Debaters (pragmatic, skeptical, creative) → Cross-Rebuttal round → Judge ruling.
- 🚦 **Router**: Intent classification → Specialized domain agent (Code, Writing, Analysis, General).
- 🗳️ **Self-Consistency**: 4 independent high-temperature reasoning samples → Consensus voting.
- 🤖 **Single (Baseline)**: One model, one call — control group.
- 🕵️ **Critic Reflection**: Multi-round structured review with automated revision loop.
- ⚖️ **Double-Blind Pairwise Judge**: Position-swapped automated scoring to eliminate position bias.

### 4. 📊 Telemetry & ROI Cost Dashboard
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
│   │   └── page.tsx              # AgentShip 2.0 Multi-Tab Mission Control UI
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

### 2. Environment Configuration

Create a `.env.local` file in the project root:

```env
GEMINI_API_KEY=your-google-ai-studio-api-key
# Optional: Proxy for environments requiring outbound proxy
# HTTPS_PROXY=http://127.0.0.1:7890
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📡 API Reference

### `POST /api/audit`
Audits a Git Unified Diff or code change payload across security, correctness, testing, and maintainability.

**Request:**
```json
{
  "diff": "diff --git a/file.ts b/file.ts\n...",
  "context": "Feature implementation description"
}
```

**Response:**
```json
{
  "id": "audit-1740870000000",
  "auditorModel": "gemini-2.5-flash",
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
Executes tasks through multi-agent topologies and streams SSE execution events.

---

## 🛣️ Roadmap

- [x] **Sprint 1 (Delivered)**:
  - [x] Multi-file Git Unified Diff Parser & Visual Diff Viewer (Unified & Split modes).
  - [x] Cross-Model Quality & Security Audit Gate with 4-dimension scoring & auto-patch.
  - [x] Telemetry ROI dashboard and session execution log.
  - [x] AgentShip 2.0 multi-tab mission control UI.
- [ ] **Sprint 2 (Upcoming)**:
  - [ ] Standard Model Context Protocol (MCP) Server endpoint (`/api/mcp`) for native Claude Code & Cursor integration.
  - [ ] Pi coding agent plugin extension (`extensions/pi-agentship.ts`).
  - [ ] Multi-model auditor selection (DeepSeek R1/V3, Claude 3.7 Sonnet, Gemini 2.5 Pro).
- [ ] **Sprint 3 (Future)**:
  - [ ] Persistent storage (Supabase / SQLite) for team audit history & trend regression.
  - [ ] Automated Git PR Webhook triggers.

---

## 📄 License

MIT © [AgentShip Team](https://github.com/hasak21/agentship)
