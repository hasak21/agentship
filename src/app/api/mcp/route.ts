// Standard Model Context Protocol (MCP) Server Endpoint for AgentShip
// Compatible with Claude Code, Cursor, Windsurf, OpenCode, and Pi.
// Implements JSON-RPC 2.0 MCP Specification (2024-11-05).

import { NextRequest, NextResponse } from "next/server";
import { executeDiffAudit } from "@/lib/auditor";
import { parseGitDiff } from "@/lib/diff-parser";
import {
  guardErrorResponse,
  HttpGuardError,
  readBoundedJsonObject,
  requireApiAccess,
} from "@/lib/http-guard";
import { callUniversalLLM, LLMRequestOptions } from "@/lib/llm";

const MAX_MCP_REQUEST_BYTES = 2 * 1024 * 1024;

const MCP_SERVER_INFO = {
  name: "AgentShip Mission Control & Quality Gate",
  version: "2.0.0",
};

const MCP_PROTOCOL_VERSION = "2024-11-05";

const MCP_TOOLS = [
  {
    name: "audit_diff",
    description:
      "Rigorously audit a Git Unified Diff or code change payload across Security, Correctness, Test Coverage, and Maintainability. Returns 4-dimension scores, blocker/warning/nitpick issues, and copyable unified diff fix patches.",
    inputSchema: {
      type: "object",
      properties: {
        diff: {
          type: "string",
          description: "The raw Git Unified Diff string (e.g. output from 'git diff').",
        },
        context: {
          type: "string",
          description: "Optional task description or PR context.",
        },
        model: {
          type: "string",
          description: "Optional model to perform audit (e.g. 'deepseek-chat', 'claude-3-7-sonnet', 'gpt-4o').",
        },
        provider: {
          type: "string",
          description: "Optional provider ('deepseek', 'anthropic', 'openai-compatible', 'ollama', 'gemini').",
        },
      },
      required: ["diff"],
    },
  },
  {
    name: "inspect_diff",
    description:
      "Parse a raw Git Unified Diff into structured multi-file statistics, file change types (add/delete/modify/rename), addition/deletion line numbers, and programming languages.",
    inputSchema: {
      type: "object",
      properties: {
        diff: {
          type: "string",
          description: "The raw Git Unified Diff string.",
        },
      },
      required: ["diff"],
    },
  },
  {
    name: "run_multiagent_topology",
    description:
      "Execute a complex coding or reasoning task through AgentShip's multi-agent topologies (orchestrator, debate, router, consistency, single, auto).",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The coding or reasoning task to execute.",
        },
        pattern: {
          type: "string",
          enum: ["orchestrator", "debate", "router", "consistency", "single", "auto"],
          description: "Multi-agent orchestration pattern to use (default: 'orchestrator').",
        },
        critic: {
          type: "boolean",
          description: "Whether to run a reflection Critic pass.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "get_telemetry_summary",
    description:
      "Retrieve AgentShip system capability manifest, supported topologies, and quality audit benchmarks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const MCP_RESOURCES = [
  {
    uri: "agentship://guidelines/audit_rubric",
    name: "AgentShip 4-Dimension Quality & Security Audit Rubric",
    mimeType: "text/markdown",
    description: "Rigorous grading rubric for agent-generated code changes.",
  },
  {
    uri: "agentship://topologies/catalog",
    name: "AgentShip Multi-Agent Topologies Catalog",
    mimeType: "application/json",
    description: "Catalog of supported multi-agent orchestration topologies.",
  },
];

export async function GET() {
  return NextResponse.json({
    status: "online",
    server: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: MCP_TOOLS.map((t) => t.name),
    resources: MCP_RESOURCES.map((r) => r.uri),
    endpoints: {
      jsonrpc: "/api/mcp",
      audit: "/api/audit",
      research: "/api/research",
    },
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    requireApiAccess(request);
    body = await readBoundedJsonObject(request, MAX_MCP_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof HttpGuardError) return guardErrorResponse(error);
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const id = body.id ?? null;
  const method = String(body.method || "");
  const params = (body.params as Record<string, unknown>) || {};

  try {
    switch (method) {
      case "initialize":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: MCP_SERVER_INFO,
          },
        });

      case "notifications/initialized":
      case "ping":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {},
        });

      case "tools/list":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS,
          },
        });

      case "tools/call": {
        const toolName = String(params.name || "");
        const args = (params.arguments as Record<string, unknown>) || {};
        const toolResult = await handleToolCall(toolName, args);

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2),
              },
            ],
          },
        });
      }

      case "resources/list":
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            resources: MCP_RESOURCES,
          },
        });

      case "resources/read": {
        const uri = String(params.uri || "");
        const resource = handleResourceRead(uri);
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            contents: [resource],
          },
        });
      }

      default:
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: '${method}'`,
            },
          },
          { status: 404 }
        );
    }
  } catch (error) {
    console.error("MCP Server execution error:", error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal MCP server error.",
        },
      },
      { status: 500 }
    );
  }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "audit_diff": {
      const diff = String(args.diff || "");
      const context = args.context ? String(args.context) : undefined;
      const model = args.model ? String(args.model) : undefined;
      const provider = args.provider as LLMRequestOptions["provider"];

      if (!diff) throw new Error("Missing required argument 'diff'.");
      return await executeDiffAudit(diff, { context, model, provider });
    }

    case "inspect_diff": {
      const diff = String(args.diff || "");
      if (!diff) throw new Error("Missing required argument 'diff'.");
      return parseGitDiff(diff);
    }

    case "run_multiagent_topology": {
      const task = String(args.task || "");
      if (!task) throw new Error("Missing required argument 'task'.");
      const pattern = String(args.pattern || "orchestrator");

      const response = await callUniversalLLM([
        {
          role: "system",
          content: `You are AgentShip Universal Orchestrator operating under topology [${pattern.toUpperCase()}]. Solve the user's task with high rigor.`,
        },
        { role: "user", content: task },
      ]);

      return {
        task,
        pattern,
        result: response.text,
        model: response.model,
        tokens: response.usage.totalTokens,
      };
    }

    case "get_telemetry_summary": {
      return {
        server: MCP_SERVER_INFO,
        status: "healthy",
        supportedTopologies: [
          "orchestrator",
          "debate",
          "router",
          "consistency",
          "single",
          "auto",
        ],
        auditDimensions: [
          "security (injection, auth, secrets)",
          "correctness (edge cases, race conditions, memory)",
          "testCoverage (unit & regression tests)",
          "maintainability (complexity & readability)",
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleResourceRead(uri: string): { uri: string; mimeType: string; text: string } {
  if (uri === "agentship://guidelines/audit_rubric") {
    return {
      uri,
      mimeType: "text/markdown",
      text: `# AgentShip Quality & Security Audit Rubric

1. **Security**: Zero tolerance for SQL/XSS/Command injections, secrets in code, or unvalidated permissions.
2. **Correctness**: Rigorous check for unhandled promise rejections, race conditions, and boundary conditions.
3. **Test Coverage**: Verifies automated test companion files and regression guardrails.
4. **Maintainability**: Clear modular separation, typing completeness, and descriptive error messages.`,
    };
  }

  if (uri === "agentship://topologies/catalog") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          orchestrator: "Planner -> Parallel Workers -> Synthesizer",
          debate: "3 Debaters -> Cross-Rebuttal -> Arbitrator Judge",
          router: "Intent Classifier -> Domain Specialist",
          consistency: "4 Independent Stochastic Samples -> Consensus Voting",
          single: "Single Agent Baseline",
          auto: "Meta-Agent Topology Dispatcher",
        },
        null,
        2
      ),
    };
  }

  throw new Error(`Resource not found: ${uri}`);
}
