// Quality and Security Audit types for AgentShip 2.0

export type AuditSeverity = "blocker" | "warning" | "nitpick";

export type AuditCategory =
  | "security"
  | "logic_bug"
  | "edge_case"
  | "performance"
  | "test_coverage"
  | "maintainability";

export type AuditIssue = {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  snippet?: string;
  suggestion?: string;
  fixPatch?: string;
};

export type AuditDimensionScore = {
  score: number; // 0 - 10
  comment: string;
};

export type AuditScores = {
  security: AuditDimensionScore;
  correctness: AuditDimensionScore;
  testCoverage: AuditDimensionScore;
  maintainability: AuditDimensionScore;
};

export type AuditReport = {
  id: string;
  taskId?: string;
  auditorModel: string;
  auditedAt: number;
  overallScore: number; // 0 - 100
  passed: boolean;
  summary: string;
  scores: AuditScores;
  issues: AuditIssue[];
  tokens: number;
  ms: number;
};
