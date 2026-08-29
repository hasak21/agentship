# AgentShip 2.0 — Coding Agent Integration Guide

This guide explains how to connect and use **AgentShip 2.0** alongside mainstream CLI coding agents (**Claude Code**, **Pi**, **DeepSeek Harness**, and **OpenCode**).

---

## 1. Integration Architecture

AgentShip 2.0 acts as the **Layer-2 Mission Control & Cross-Audit Gate** for your CLI agents:

```
[ Developer Terminal ] ───► Runs: Claude Code / Pi / OpenCode / DSH
                                    │
                                    ▼ (Generates Git Diff / Commits)
[ AgentShip 2.0 ] ◄────────────── (Ingest via REST API / Web UI / MCP)
       │
       ├─► 🔍 Visual Diff Review (Interactive multi-file inspection)
       ├─► 🛡️ Cross-Audit Gate (Independent Security & Correctness verification)
       └─► 📊 Telemetry ROI (Cost attribution & latency tracking)
```

---

## 2. Ingesting Agent Changes

### Method A: Web UI Direct Ingestion (Zero Setup)
1. In your project where your CLI agent just made code changes, run:
   ```bash
   git diff HEAD~1 > patch.diff
   # or for unstaged changes:
   git diff > patch.diff
   ```
2. Open AgentShip 2.0 at `http://localhost:3000`.
3. Switch to the **🔍 Visual Diff Review** tab and paste the diff.
4. Click **🛡️ Cross-Audit Diff** to trigger an independent multi-model audit.

### Method B: REST API Integration (CI/CD & Scripts)
You can trigger an audit programmatically in your pre-commit hook or CI pipeline:

```bash
curl -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "diff": "'"$(git diff | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/"/\\"/g')"'",
    "context": "Feature branch PR audit"
  }'
```

---

## 3. Tool-Specific Integration Patterns

### 3.1 Claude Code
- **Workflow**: Use Claude Code (`claude`) in your terminal for multi-file edits and plan mode.
- **Review**: Once Claude Code completes a task, paste the generated diff into AgentShip's **Visual Diff Review** tab to inspect changes and run the 4-dimension audit before merging or committing.

### 3.2 Pi (pi-coding-agent)
- Pi is designed around minimalist TypeScript extensions.
- You can create a Pi extension that automatically posts the diff to AgentShip on task completion:
  ```typescript
  // extensions/pi-agentship.ts
  export default function agentshipExtension(pi: any) {
    pi.on("task_done", async (context: any) => {
      const diff = await pi.exec("git diff");
      if (diff) {
        await fetch("http://localhost:3000/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diff, context: context.taskPrompt }),
        });
      }
    });
  }
  ```

### 3.3 DeepSeek Harness (dsh)
- In DeepSeek Harness, AgentShip's `/api/audit` can be plugged in as an evaluation or post-execution step in its Cordis plugin chain.

### 3.4 OpenCode
- Use OpenCode for local and multi-provider code generation. When review is needed, use AgentShip's **Split Diff** view to inspect changes side-by-side.

---

## 4. Multi-Dimension Audit Checklist

When AgentShip audits your code, it strictly checks:

1. **Security (`security`)**:
   - Injection vulnerabilities (SQL, XSS, Command Injection).
   - Insecure dependencies, credential/token leakage in code.
   - Path traversal and authentication/authorization bypasses.
2. **Correctness (`correctness`)**:
   - Null pointer and undefined access.
   - Unhandled asynchronous errors and promise rejections.
   - Concurrency race conditions and boundary/off-by-one errors.
3. **Test Coverage (`testCoverage`)**:
   - Verification of accompanying unit tests.
   - Boundary condition testing.
4. **Maintainability (`maintainability`)**:
   - Cyclomatic complexity and dead code.
   - Readability and API documentation clarity.
