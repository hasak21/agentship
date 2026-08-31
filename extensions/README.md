# AgentShip Extensions & Integrations

This directory contains companion extensions and plugin scripts for CLI coding agents.

## 1. Pi Coding Agent (`extensions/pi-agentship.ts`)

Connects [Pi](https://github.com/badlogic/pi-coding-agent) directly with AgentShip's Cross-Model Quality Gate and MCP Server.

### Installation & Usage

Run Pi with the extension flag:

```bash
pi -e ./extensions/pi-agentship.ts
```

### Supported Commands in Pi

- `/audit` — Audits the current uncommitted git changes against Security, Correctness, Test Coverage, and Maintainability.
- `/audit HEAD~1` — Audits changes from the previous commit.
- `/diff` — Summarizes changed files and line delta in terminal.
- `/agentship` — Displays AgentShip status and web dashboard URL.

---

## 2. Claude Code MCP Integration

Claude Code can use AgentShip as a native MCP server for auditing diffs and running multi-agent topologies.

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "agentship": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

Or run via CLI:

```bash
claude mcp add agentship http://localhost:3000/api/mcp
```

---

## 3. Cursor / Windsurf MCP Integration

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentship": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```
