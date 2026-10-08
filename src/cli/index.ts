#!/usr/bin/env node
import { writeSync } from "node:fs";
import path from "node:path";
import { measureCalibration } from "../review/calibration";
import { runIntentBenchmark } from "../review/intent-benchmark";
import {
  recordFindingOutcome,
  type FindingOutcomeStatus,
} from "../review/outcome";
import { runReview } from "../review/review";
import {
  signEvidenceReport,
  verifyEvidenceSignature,
} from "../review/signature";

interface CliOptions {
  taskPath?: string;
  configPath?: string;
  base?: string;
  staged: boolean;
  outputPath?: string;
  baselinePath?: string;
  confirmedRequirementIds: string[];
  approvedProtectedPathPatterns: string[];
  overridePath?: string;
  historyDirectory?: string;
  signingKeyPath?: string;
  signatureOutputPath?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    staged: false,
    confirmedRequirementIds: [],
    approvedProtectedPathPatterns: [],
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (index === 0 && arg === "review") continue;
    if (arg === "--staged") {
      options.staged = true;
      continue;
    }
    if (["--task", "--config", "--base", "--baseline", "--override", "--history", "--output", "--confirm", "--approve-path", "--signing-key", "--signature-output"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--task") options.taskPath = value;
      if (arg === "--config") options.configPath = value;
      if (arg === "--base") options.base = value;
      if (arg === "--baseline") options.baselinePath = value;
      if (arg === "--override") options.overridePath = value;
      if (arg === "--history") options.historyDirectory = value;
      if (arg === "--output") options.outputPath = value;
      if (arg === "--signing-key") options.signingKeyPath = value;
      if (arg === "--signature-output") options.signatureOutputPath = value;
      if (arg === "--confirm") {
        options.confirmedRequirementIds.push(
          ...value.split(",").map((id) => id.trim()).filter(Boolean)
        );
      }
      if (arg === "--approve-path") {
        options.approvedProtectedPathPatterns.push(value);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.signatureOutputPath && !options.signingKeyPath) {
    throw new Error("--signature-output requires --signing-key.");
  }
  return options;
}

function printHelp(): void {
  const output = `AgentShip Verify — evidence-based preflight for agent-written code

Usage:
  agentship review [options]
  agentship benchmark --fixtures <path>
  agentship outcome --report <path> --finding-id <id> --finding-kind <kind> --status <status> --actor <actor> --reason <reason>
  agentship metrics --outcomes <dir> --reports <dir> --benchmark-fixtures <path>
  agentship verify-signature --report <path> --signature <path> --public-key <path>
  npm run review -- [options]

Options:
  --task <path>    Task or requirements document to bind to the report
  --base <ref>     Review committed changes since the merge base with <ref>
  --staged         Review staged changes instead of the working tree
  --config <path>  Configuration path (default: .agentship.yml)
  --baseline <path> Prior AgentShip JSON report for finding comparison
  --override <path> Bounded override record referencing a prior report hash
  --history <dir>  Record history and select the latest compatible baseline
  --output <path>  JSON report path
  --signing-key <path> Sign exact JSON evidence with an external Ed25519 private key
  --signature-output <path> Detached signature path (default: report .sig.json)
  --confirm <ids>  Confirm comma-separated requirements marked [confirm]
  --approve-path <pattern> Confirm one configured protected-path policy (repeatable)
  -h, --help       Show this help\n`;
  writeStdout(output);
}

function writeStdout(output: string): void {
  writeSync(1, output);
}

function parseMetricsArgs(args: string[]): {
  outcomesDirectory: string;
  reportsDirectory: string;
  benchmarkFixturePath: string;
} {
  const values = new Map<string, string>();
  const supported = new Set(["--outcomes", "--reports", "--benchmark-fixtures"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!supported.has(arg)) throw new Error(`Unknown metrics argument: ${arg}`);
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value.`);
    if (values.has(arg)) throw new Error(`${arg} may only be provided once.`);
    values.set(arg, value);
  }
  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new Error(`metrics requires ${flag} <value>.`);
    return value;
  };
  return {
    outcomesDirectory: required("--outcomes"),
    reportsDirectory: required("--reports"),
    benchmarkFixturePath: required("--benchmark-fixtures"),
  };
}

interface OutcomeCliOptions {
  reportPath: string;
  findingId: string;
  findingKind: string;
  status: FindingOutcomeStatus;
  actor: string;
  reason: string;
  outputDirectory?: string;
  resolutionReportPath?: string;
}

function parseOutcomeArgs(args: string[]): OutcomeCliOptions {
  const values = new Map<string, string>();
  const supported = new Set([
    "--report",
    "--finding-id",
    "--finding-kind",
    "--status",
    "--actor",
    "--reason",
    "--output-dir",
    "--resolution-report",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!supported.has(arg)) throw new Error(`Unknown outcome argument: ${arg}`);
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value.`);
    if (values.has(arg)) throw new Error(`${arg} may only be provided once.`);
    values.set(arg, value);
  }
  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new Error(`outcome requires ${flag} <value>.`);
    return value;
  };
  const status = required("--status");
  if (!["accepted", "rejected", "fixed", "overridden"].includes(status)) {
    throw new Error("--status must be accepted, rejected, fixed, or overridden.");
  }
  return {
    reportPath: required("--report"),
    findingId: required("--finding-id"),
    findingKind: required("--finding-kind"),
    status: status as FindingOutcomeStatus,
    actor: required("--actor"),
    reason: required("--reason"),
    outputDirectory: values.get("--output-dir"),
    resolutionReportPath: values.get("--resolution-report"),
  };
}

function parseBenchmarkArgs(args: string[]): string {
  let fixturePath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fixtures") {
      fixturePath = args[++index];
      if (!fixturePath) throw new Error("--fixtures requires a value.");
      continue;
    }
    throw new Error(`Unknown benchmark argument: ${arg}`);
  }
  if (!fixturePath) throw new Error("benchmark requires --fixtures <path>.");
  return fixturePath;
}

function parseVerifySignatureArgs(args: string[]): {
  reportPath: string;
  signaturePath: string;
  publicKeyPath: string;
} {
  const values = new Map<string, string>();
  const supported = new Set(["--report", "--signature", "--public-key"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!supported.has(arg)) {
      throw new Error(`Unknown verify-signature argument: ${arg}`);
    }
    const value = args[++index];
    if (!value) throw new Error(`${arg} requires a value.`);
    if (values.has(arg)) throw new Error(`${arg} may only be provided once.`);
    values.set(arg, value);
  }
  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new Error(`verify-signature requires ${flag} <path>.`);
    return path.resolve(process.cwd(), value);
  };
  return {
    reportPath: required("--report"),
    signaturePath: required("--signature"),
    publicKeyPath: required("--public-key"),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args[0] === "benchmark") {
    const fixturePath = path.resolve(process.cwd(), parseBenchmarkArgs(args.slice(1)));
    const benchmark = await runIntentBenchmark(fixturePath);
    writeStdout(`${JSON.stringify(benchmark, null, 2)}\n`);
    return;
  }
  if (args[0] === "outcome") {
    const options = parseOutcomeArgs(args.slice(1));
    const result = await recordFindingOutcome({
      repositoryRoot: process.cwd(),
      ...options,
    });
    writeStdout([
      `AgentShip outcome: ${result.outcome.status}`,
      `Finding: ${result.outcome.finding.id} (${result.outcome.finding.kind})`,
      `Evidence: ${result.outcome.evidence}`,
      `Record: ${result.outputPath}`,
      "",
    ].join("\n"));
    return;
  }
  if (args[0] === "metrics") {
    const metrics = await measureCalibration({
      repositoryRoot: process.cwd(),
      ...parseMetricsArgs(args.slice(1)),
    });
    writeStdout(`${JSON.stringify(metrics, null, 2)}\n`);
    return;
  }
  if (args[0] === "verify-signature") {
    const statement = await verifyEvidenceSignature({
      ...parseVerifySignatureArgs(args.slice(1)),
      trustedRoot: process.cwd(),
    });
    writeStdout(
      `AgentShip signature: VALID\nReport SHA-256: ${statement.reportSha256}\nPublic key SHA-256: ${statement.publicKeySha256}\n`
    );
    return;
  }
  const options = parseArgs(args);
  const result = await runReview({
    cwd: process.cwd(),
    verifierEntrypoint: process.argv[1],
    taskPath: options.taskPath,
    configPath: options.configPath,
    base: options.base,
    staged: options.staged,
    outputPath: options.outputPath,
    baselinePath: options.baselinePath,
    confirmedRequirementIds: options.confirmedRequirementIds,
    approvedProtectedPathPatterns: options.approvedProtectedPathPatterns,
    overridePath: options.overridePath,
    historyDirectory: options.historyDirectory,
  });

  const { report } = result;
  const signed = options.signingKeyPath
    ? await signEvidenceReport({
        repositoryRoot: report.repository.root,
        reportPath: result.jsonPath,
        privateKeyPath: path.resolve(process.cwd(), options.signingKeyPath),
        ...(options.signatureOutputPath
          ? { outputPath: path.resolve(process.cwd(), options.signatureOutputPath) }
          : {}),
      })
    : undefined;
  const output = [
    "",
    `AgentShip review: ${report.verdict}`,
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.timedOut} timed out, ${report.summary.skipped} skipped`,
    `Findings: ${report.findings.length - report.summary.suppressed - report.summary.overridden} active, ${report.summary.suppressed} suppressed, ${report.summary.overridden} overridden`,
  ];
  if (report.baseline) {
    output.push(`Baseline: ${report.baseline.newFindings.length} new, ${report.baseline.existingFindings.length} existing, ${report.baseline.resolvedFindings.length} resolved`);
  }
  const pendingProtectedPaths = report.configuration.protectedPaths.filter(
    ({ approval }) => approval === "required"
  );
  if (pendingProtectedPaths.length > 0) {
    output.push(
      `Protected paths awaiting approval: ${pendingProtectedPaths.map(({ pattern }) => pattern).join(", ")}`
    );
  }
  output.push(`Changed files: ${report.repository.changedFiles.length}`);
  output.push(`Evidence: ${path.relative(process.cwd(), result.jsonPath)}`);
  output.push(`Report: ${path.relative(process.cwd(), result.markdownPath)}`);
  output.push(`SARIF: ${path.relative(process.cwd(), result.sarifPath)}`);
  if (signed) {
    output.push(`Signature: ${path.relative(process.cwd(), signed.outputPath)}`);
  }
  if (result.historyJsonPath) {
    output.push(`History: ${path.relative(process.cwd(), result.historyJsonPath)}`);
  }
  writeStdout(`${output.join("\n")}\n`);

  if (report.mode === "gate" && report.verdict === "BLOCK") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  writeSync(2, `AgentShip command failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
