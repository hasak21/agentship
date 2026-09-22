export type ReviewMode = "report" | "gate";
export type ReviewVerdict = "PASS" | "WARN" | "BLOCK";
export type CheckStatus = "passed" | "failed" | "timed_out" | "skipped";

export type ReviewFindingKind =
  | "required_check_failed"
  | "required_check_timed_out"
  | "optional_check_failed"
  | "repository_changed_during_review"
  | "explicit_requirement_path_unchanged"
  | "explicit_requirement_evidence_unsatisfied"
  | "inferred_requirement_role_missing"
  | "unattributed_changes"
  | "review_budget_exceeded"
  | "requirement_confirmation_missing"
  | "protected_path_approval_missing";

export interface ReviewCheckConfig {
  name: string;
  run: string;
  required?: boolean;
  timeoutSeconds?: number;
  network?: "allowed" | "denied";
  environment?: string[];
  whenChanged?: string[];
}

export interface ProtectedPathPolicy {
  pattern: string;
  requireManualApproval?: boolean;
}

export type SuppressibleFindingKind =
  | "optional_check_failed"
  | "explicit_requirement_path_unchanged"
  | "explicit_requirement_evidence_unsatisfied"
  | "inferred_requirement_role_missing"
  | "unattributed_changes";

export type OverrideableFindingKind =
  | "required_check_failed"
  | "required_check_timed_out"
  | SuppressibleFindingKind;

export interface FindingSuppressionConfig {
  id: string;
  findingId: string;
  kind: SuppressibleFindingKind;
  owner: string;
  reason: string;
  expiresAt: string;
}

export interface AgentShipConfig {
  version: 1;
  mode: ReviewMode;
  checks: ReviewCheckConfig[];
  limits?: {
    maxChangedFiles?: number;
    maxDiffBytes?: number;
  };
  policy?: {
    blockOn?: ReviewFindingKind[];
    protectedPaths?: ProtectedPathPolicy[];
    suppressions?: FindingSuppressionConfig[];
  };
}

export interface CheckEvidence {
  name: string;
  command: string;
  required: boolean;
  network: "allowed" | "denied" | "unspecified";
  environment: string[];
  status: CheckStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  selection?: {
    patterns: string[];
    matchedFiles: string[];
  };
  skipReason?: "no_changed_path_match" | "review_budget_exceeded";
}

export interface ReviewFinding {
  id: string;
  severity: "blocker" | "warning";
  kind: ReviewFindingKind;
  title: string;
  evidence: {
    check?: string;
    command?: string;
    exitCode?: number | null;
    beforeHead?: string;
    afterHead?: string;
    beforeDiffSha256?: string;
    afterDiffSha256?: string;
    requirementId?: string;
    expectedPaths?: string[];
    expectedChecks?: Array<{
      name: string;
      status: CheckStatus | "not_configured";
    }>;
    expectedSymbols?: Array<{
      path: string;
      symbol: string;
      status: "changed" | "file_unchanged" | "symbol_not_in_diff" | "diff_unavailable";
    }>;
    expectedRoles?: Array<"test" | "documentation">;
    unexpectedPaths?: string[];
    budget?: "changed_files" | "diff_bytes";
    observed?: number;
    limit?: number;
    protectedPathPattern?: string;
  };
  suppression?: {
    id: string;
    owner: string;
    reason: string;
    expiresAt: string;
  };
  override?: {
    id: string;
    actor: string;
    reason: string;
    expiresAt: string;
    reportSha256: string;
  };
}

export interface FindingIdentity {
  id: string;
  kind: string;
  severity: "blocker" | "warning";
}

export interface BaselineComparison {
  path: string;
  sha256: string;
  runId: string;
  head: string;
  newFindings: FindingIdentity[];
  existingFindings: FindingIdentity[];
  resolvedFindings: FindingIdentity[];
}

export interface ReviewReport {
  schemaVersion: 1;
  runId: string;
  tool: { name: "AgentShip Verify"; version: string };
  mode: ReviewMode;
  verdict: ReviewVerdict;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  repository: {
    root: string;
    head: string;
    postCheckHead: string;
    base?: string;
    reviewScope: "working-tree" | "staged" | "base";
    diffSha256: string;
    postCheckDiffSha256: string;
    stableDuringChecks: boolean;
    changedFiles: string[];
  };
  task?: {
    path: string;
    sha256: string;
    options: {
      strictChangeCoverage: boolean;
    };
    requirements: Array<{
      id: string;
      text: string;
      line: number;
      confirmation: "not_required" | "required" | "confirmed";
      confirmationBasis: Array<"task_marker" | "protected_path">;
    }>;
    mappings: Array<{
      requirementId: string;
      basis:
        | "explicit_path"
        | "explicit_check"
        | "explicit_path_and_check"
        | "explicit_symbol"
        | "explicit_mixed"
        | "inferred_file_role"
        | "none";
      references: string[];
      observedFiles: string[];
      missingReferences: string[];
      checkReferences: string[];
      checkEvidence: Array<{
        name: string;
        status: CheckStatus | "not_configured";
      }>;
      symbolReferences: Array<{
        path: string;
        symbol: string;
      }>;
      symbolEvidence: Array<{
        path: string;
        symbol: string;
        status: "changed" | "file_unchanged" | "symbol_not_in_diff" | "diff_unavailable";
      }>;
      inferredRoles: Array<"test" | "documentation">;
      roleEvidence: Array<{
        role: "test" | "documentation";
        observedFiles: string[];
      }>;
      missingRoles: Array<"test" | "documentation">;
      status:
        | "observed"
        | "missing"
        | "inferred_observed"
        | "inferred_missing"
        | "unmapped";
    }>;
    changeCoverage: {
      attributedFiles: string[];
      unattributedFiles: string[];
    };
  };
  configuration: {
    path: string;
    sha256: string;
    blockingPolicy: {
      configuredKinds: ReviewFindingKind[];
    };
    protectedPaths: Array<{
      pattern: string;
      matchedFiles: string[];
      approval: "not_required" | "required" | "confirmed";
    }>;
  };
  checks: CheckEvidence[];
  budget?: {
    changedFiles: number;
    diffBytes: number;
    limits: {
      maxChangedFiles?: number;
      maxDiffBytes?: number;
    };
  };
  baseline?: BaselineComparison;
  override?: {
    path: string;
    sha256: string;
    id: string;
    actor: string;
    reason: string;
    expiresAt: string;
    sourceReport: {
      path: string;
      sha256: string;
      runId: string;
    };
    findings: Array<{
      id: string;
      kind: OverrideableFindingKind;
    }>;
  };
  history?: {
    directory: string;
    selection: "none_found" | "automatic_compatible" | "explicit";
    recordedReport: string;
  };
  findings: ReviewFinding[];
  summary: {
    passed: number;
    failed: number;
    timedOut: number;
    skipped: number;
    suppressed: number;
    overridden: number;
  };
}
