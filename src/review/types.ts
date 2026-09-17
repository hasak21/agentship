export type ReviewMode = "report" | "gate";
export type ReviewVerdict = "PASS" | "WARN" | "BLOCK";
export type CheckStatus = "passed" | "failed" | "timed_out";

export interface ReviewCheckConfig {
  name: string;
  run: string;
  required?: boolean;
  timeoutSeconds?: number;
  network?: "allowed" | "denied";
  environment?: string[];
}

export interface ProtectedPathPolicy {
  pattern: string;
  requireManualApproval?: boolean;
}

export interface AgentShipConfig {
  version: 1;
  mode: ReviewMode;
  checks: ReviewCheckConfig[];
  policy?: {
    blockOn?: string[];
    protectedPaths?: ProtectedPathPolicy[];
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
}

export interface ReviewFinding {
  id: string;
  severity: "blocker" | "warning";
  kind:
    | "required_check_failed"
    | "required_check_timed_out"
    | "optional_check_failed"
    | "repository_changed_during_review"
    | "explicit_requirement_path_unchanged"
    | "explicit_requirement_evidence_unsatisfied"
    | "inferred_requirement_role_missing"
    | "unattributed_changes"
    | "requirement_confirmation_missing";
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
  };
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
  };
  checks: CheckEvidence[];
  findings: ReviewFinding[];
  summary: {
    passed: number;
    failed: number;
    timedOut: number;
  };
}
