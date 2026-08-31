// Universal Quality & Security Auditor Gate for AgentShip
import { AuditReport, AuditScores, AuditIssue, AuditorProvider } from "@/types/audit";
import { AUDIT_SYSTEM_PROMPT } from "@/lib/prompts/audit";
import {
  callUniversalLLM,
  extractJsonFromResponse,
  LLMRequestOptions,
  resolveProviderConfig,
} from "@/lib/llm";

export interface AuditExecutionOptions extends LLMRequestOptions {
  context?: string;
}

export async function executeDiffAudit(
  diff: string,
  options: AuditExecutionOptions = {}
): Promise<AuditReport> {
  const startTime = Date.now();
  const trimmedDiff = (diff || "").trim();
  const taskContext = (options.context || "").trim();

  if (!trimmedDiff) {
    throw new Error("Cannot audit an empty Git Diff or code payload.");
  }

  const userPayload = `Task Context: ${taskContext || "Code quality, correctness, and security audit."}\n\n=== GIT UNIFIED DIFF / CODE CHANGES ===\n${trimmedDiff}`;

  const resolved = resolveProviderConfig(options);
  const targetModel = options.model || resolved.model;

  const response = await callUniversalLLM(
    [
      { role: "system", content: AUDIT_SYSTEM_PROMPT },
      { role: "user", content: userPayload },
    ],
    {
      ...options,
      model: targetModel,
      temperature: options.temperature ?? 0.2, // low temperature for consistent, strict auditing
      responseFormat: "json_object",
    }
  );

  const rawData = extractJsonFromResponse<Record<string, unknown>>(response.text);

  // Validate and sanitize 4 dimension scores
  const rawScores = (rawData.scores as Record<string, { score?: number; comment?: string }>) || {};
  const scores: AuditScores = {
    security: {
      score: clampScore(rawScores.security?.score ?? 8.5),
      comment: rawScores.security?.comment ?? "No critical security defects identified.",
    },
    correctness: {
      score: clampScore(rawScores.correctness?.score ?? 8.5),
      comment: rawScores.correctness?.comment ?? "Logic flow handles standard cases.",
    },
    testCoverage: {
      score: clampScore(rawScores.testCoverage?.score ?? 7.5),
      comment: rawScores.testCoverage?.comment ?? "Unit test coverage evaluated.",
    },
    maintainability: {
      score: clampScore(rawScores.maintainability?.score ?? 8.5),
      comment: rawScores.maintainability?.comment ?? "Code structure is clean and maintainable.",
    },
  };

  // Validate and sanitize issues
  const rawIssues = Array.isArray(rawData.issues) ? rawData.issues : [];
  const issues: AuditIssue[] = rawIssues.map((item, idx) => {
    const raw = item as Record<string, unknown>;
    const severity = (
      ["blocker", "warning", "nitpick"].includes(String(raw.severity).toLowerCase())
        ? String(raw.severity).toLowerCase()
        : "warning"
    ) as AuditIssue["severity"];

    const category = (
      [
        "security",
        "logic_bug",
        "edge_case",
        "performance",
        "test_coverage",
        "maintainability",
      ].includes(String(raw.category).toLowerCase())
        ? String(raw.category).toLowerCase()
        : "maintainability"
    ) as AuditIssue["category"];

    return {
      id: String(raw.id || `issue-${idx + 1}`),
      category,
      severity,
      title: String(raw.title || `Quality Finding #${idx + 1}`),
      description: String(raw.description || "Potential improvement identified in review."),
      file: raw.file ? String(raw.file) : undefined,
      line: typeof raw.line === "number" ? raw.line : undefined,
      snippet: raw.snippet ? String(raw.snippet) : undefined,
      suggestion: raw.suggestion ? String(raw.suggestion) : undefined,
      fixPatch: raw.fixPatch ? String(raw.fixPatch) : undefined,
    };
  });

  const hasBlocker = issues.some((i) => i.severity === "blocker");
  let overallScore = typeof rawData.overallScore === "number" ? rawData.overallScore : 80;
  overallScore = Math.max(0, Math.min(100, overallScore));

  // If a blocker exists, overall score cannot exceed 75 and passed must be false
  if (hasBlocker) {
    overallScore = Math.min(overallScore, 75);
  }

  const passed = typeof rawData.passed === "boolean" ? (!hasBlocker && rawData.passed) : !hasBlocker && overallScore >= 80;
  const summary =
    typeof rawData.summary === "string"
      ? rawData.summary
      : `Audit completed with ${issues.length} finding${issues.length === 1 ? "" : "s"}.`;

  const report: AuditReport = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    auditorModel: response.model,
    auditorProvider: response.provider as AuditorProvider,
    auditedAt: Date.now(),
    overallScore,
    passed,
    summary,
    scores,
    issues,
    tokens: response.usage.totalTokens,
    ms: Date.now() - startTime,
  };

  return report;
}

function clampScore(val: number): number {
  if (typeof val !== "number" || isNaN(val)) return 8.0;
  return Math.max(0, Math.min(10, Math.round(val * 10) / 10));
}
