// Agent execution, telemetry and event types for AgentShip 2.0

export type AgentRole =
  | "planner"
  | "worker"
  | "synthesizer"
  | "debater"
  | "judge"
  | "router"
  | "specialist"
  | "critic"
  | "reviser"
  | "auditor"
  | "tester";

export type AgentNode = {
  id: string;
  role: AgentRole | string;
  title: string;
  subtitle: string;
  state: "idle" | "running" | "done" | "failed";
  result?: string;
  ms?: number;
  tokens?: number;
  model?: string;
  failed?: boolean;
  confidence?: "high" | "medium" | "low";
  retried?: boolean;
  toolCalls?: {
    tool: string;
    args?: Record<string, unknown>;
    output?: string;
  }[];
};

export type ExecutionTrack = {
  id: string;
  pattern: string;
  label: string;
  nodes: AgentNode[];
  final?: {
    answer: string;
    sources?: { title: string; uri: string }[];
    diff?: string;
    stats?: {
      calls: number;
      tokens: number;
      ms: number;
    };
  };
};

export type TaskTelemetry = {
  taskId: string;
  taskTitle: string;
  agentCount: number;
  totalTokens: number;
  wallTimeMs: number;
  linesAdded: number;
  linesDeleted: number;
  auditScore?: number;
  timestamp: number;
};
