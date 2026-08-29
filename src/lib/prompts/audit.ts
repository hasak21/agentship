// System prompts and JSON schemas for Code Quality & Security Audit

export const AUDIT_SYSTEM_PROMPT = `You are a Senior Principal Software Architect and Security Auditor (Cross-Model Quality Gate).
Your job is to rigorously review the provided Git Diff or Code Changes produced by a Coding Agent.

Audit the code across 4 strict dimensions:
1. SECURITY: Injection vulnerabilities (SQL/XSS/Command), insecure deserialization, credential leakage, path traversal, auth bypass.
2. CORRECTNESS: Edge cases, null pointer/undefined dereferences, off-by-one errors, unhandled promise rejections, race conditions, memory leaks.
3. TEST_COVERAGE: Whether corresponding unit/integration tests were added or updated, regression risk on existing features.
4. MAINTAINABILITY: Code readability, cyclomatic complexity, antipatterns, error reporting clarity.

Rules:
- Be rigorous and objective.
- Classify issues strictly by severity:
  - blocker: Must be fixed before merge. Causes security vulnerability, crash, severe data corruption, or breaking change.
  - warning: Potential bug under specific conditions, missing crucial test coverage, or notable performance degradation.
  - nitpick: Non-blocking readability or minor stylistic improvement.
- Provide a concrete, actionable suggestion and a unified diff fixPatch whenever possible.
- Calculate scores (0.0 to 10.0) for each of the 4 dimensions.
- Overall score is 0 to 100. If any blocker exists, passed MUST be false and score should be below 80.`;

export const AUDIT_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    overallScore: { type: "NUMBER" },
    passed: { type: "BOOLEAN" },
    summary: { type: "STRING" },
    scores: {
      type: "OBJECT",
      properties: {
        security: {
          type: "OBJECT",
          properties: {
            score: { type: "NUMBER" },
            comment: { type: "STRING" },
          },
          required: ["score", "comment"],
        },
        correctness: {
          type: "OBJECT",
          properties: {
            score: { type: "NUMBER" },
            comment: { type: "STRING" },
          },
          required: ["score", "comment"],
        },
        testCoverage: {
          type: "OBJECT",
          properties: {
            score: { type: "NUMBER" },
            comment: { type: "STRING" },
          },
          required: ["score", "comment"],
        },
        maintainability: {
          type: "OBJECT",
          properties: {
            score: { type: "NUMBER" },
            comment: { type: "STRING" },
          },
          required: ["score", "comment"],
        },
      },
      required: ["security", "correctness", "testCoverage", "maintainability"],
    },
    issues: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          category: {
            type: "STRING",
            enum: [
              "security",
              "logic_bug",
              "edge_case",
              "performance",
              "test_coverage",
              "maintainability",
            ],
          },
          severity: {
            type: "STRING",
            enum: ["blocker", "warning", "nitpick"],
          },
          title: { type: "STRING" },
          description: { type: "STRING" },
          file: { type: "STRING" },
          line: { type: "NUMBER" },
          snippet: { type: "STRING" },
          suggestion: { type: "STRING" },
          fixPatch: { type: "STRING" },
        },
        required: ["id", "category", "severity", "title", "description"],
      },
    },
  },
  required: ["overallScore", "passed", "summary", "scores", "issues"],
};
