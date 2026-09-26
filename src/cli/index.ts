#!/usr/bin/env node
import path from "node:path";
import { runIntentBenchmark } from "../review/intent-benchmark";
import {
  measureFindingOutcomes,
  recordFindingOutcome,
  type FindingOutcomeStatus,
} from "../review/outcome";
import { runReview } from "../review/review";

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
    if (["--task", "--config", "--base", "--baseline", "--override", "--history", "--output", "--confirm", "--approve-path"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--task") options.taskPath = value;
      if (arg === "--config") options.configPath = value;
      if (arg === "--base") options.base = value;
      if (arg === "--baseline") options.baselinePath = value;
      if (arg === "--override") options.overridePath = value;
      if (arg === "--history") options.historyDirectory = value;
      if (arg === "--output") options.outputPath = value;
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
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`AgentShip Verify — evidence-based preflight for agent-written code

Usage:
  agentship review [options]
  agentship benchmark --fixtures <path>
  agentship outcome --report <path> --finding-id <id> --finding-kind <kind> --status <status> --actor <actor> --reason <reason>
  agentship metrics [--outcomes <directory>]
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
  --confirm <ids>  Confirm comma-separated requirements marked [confirm]
  --approve-path <pattern> Confirm one configured protected-path policy (repeatable)
  -h, --help       Show this help`);
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
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
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
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown benchmark argument: ${arg}`);
  }
  if (!fixturePath) throw new Error("benchmark requires --fixtures <path>.");
  return fixturePath;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "metrics") {
    if (args.length > 3 || (args.length > 1 && args[1] !== "--outcomes")) {
      throw new Error("Usage: agentship metrics [--outcomes <directory>].");
    }
    if (args[1] === "--outcomes" && !args[2]) {
      throw new Error("--outcomes requires a value.");
    }
    const metrics = await measureFindingOutcomes(process.cwd(), args[2]);
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }
  if (args[0] === "benchmark") {
    const fixturePath = path.resolve(process.cwd(), parseBenchmarkArgs(args.slice(1)));
    const benchmark = await runIntentBenchmark(fixturePath);
    console.log(JSON.stringify(benchmark, null, 2));
    return;
  }
  if (args[0] === "outcome") {
    const options = parseOutcomeArgs(args.slice(1));
    const result = await recordFindingOutcome({
      repositoryRoot: process.cwd(),
      ...options,
    });
    console.log(`AgentShip outcome: ${result.outcome.status}`);
    console.log(`Finding: ${result.outcome.finding.id} (${result.outcome.finding.kind})`);
    console.log(`Evidence: ${result.outcome.evidence}`);
    console.log(`Record: ${result.outputPath}`);
    return;
  }
  const options = parseArgs(args);
  const result = await runReview({
    cwd: process.cwd(),
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
  console.log(`\nAgentShip review: ${report.verdict}`);
  console.log(`Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.timedOut} timed out, ${report.summary.skipped} skipped`);
  console.log(`Findings: ${report.findings.length - report.summary.suppressed - report.summary.overridden} active, ${report.summary.suppressed} suppressed, ${report.summary.overridden} overridden`);
  if (report.baseline) {
    console.log(`Baseline: ${report.baseline.newFindings.length} new, ${report.baseline.existingFindings.length} existing, ${report.baseline.resolvedFindings.length} resolved`);
  }
  const pendingProtectedPaths = report.configuration.protectedPaths.filter(
    ({ approval }) => approval === "required"
  );
  if (pendingProtectedPaths.length > 0) {
    console.log(
      `Protected paths awaiting approval: ${pendingProtectedPaths.map(({ pattern }) => pattern).join(", ")}`
    );
  }
  console.log(`Changed files: ${report.repository.changedFiles.length}`);
  console.log(`Evidence: ${path.relative(process.cwd(), result.jsonPath)}`);
  console.log(`Report: ${path.relative(process.cwd(), result.markdownPath)}`);
  console.log(`SARIF: ${path.relative(process.cwd(), result.sarifPath)}`);
  if (result.historyJsonPath) {
    console.log(`History: ${path.relative(process.cwd(), result.historyJsonPath)}`);
  }

  if (report.mode === "gate" && report.verdict === "BLOCK") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`AgentShip review failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
