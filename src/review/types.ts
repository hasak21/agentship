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
    | "repository_changed_during_review";
  title: string;
  evidence: {
    check?: string;
    command?: string;
    exitCode?: number | null;
    beforeHead?: string;
    afterHead?: string;
    beforeDiffSha256?: string;
    afterDiffSha256?: string;
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
    requirements: Array<{
      id: string;
      text: string;
      line: number;
      confirmation: "explicit";
    }>;
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
