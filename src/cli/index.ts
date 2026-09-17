#!/usr/bin/env node
import path from "node:path";
import { runIntentBenchmark } from "../review/intent-benchmark";
import { runReview } from "../review/review";

interface CliOptions {
  taskPath?: string;
  configPath?: string;
  base?: string;
  staged: boolean;
  outputPath?: string;
  confirmedRequirementIds: string[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { staged: false, confirmedRequirementIds: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (index === 0 && arg === "review") continue;
    if (arg === "--staged") {
      options.staged = true;
      continue;
    }
    if (["--task", "--config", "--base", "--output", "--confirm"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--task") options.taskPath = value;
      if (arg === "--config") options.configPath = value;
      if (arg === "--base") options.base = value;
      if (arg === "--output") options.outputPath = value;
      if (arg === "--confirm") {
        options.confirmedRequirementIds.push(
          ...value.split(",").map((id) => id.trim()).filter(Boolean)
        );
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
  npm run review -- [options]

Options:
  --task <path>    Task or requirements document to bind to the report
  --base <ref>     Review committed changes since the merge base with <ref>
  --staged         Review staged changes instead of the working tree
  --config <path>  Configuration path (default: .agentship.yml)
  --output <path>  JSON report path
  --confirm <ids>  Confirm comma-separated requirements marked [confirm]
  -h, --help       Show this help`);
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
  if (args[0] === "benchmark") {
    const fixturePath = path.resolve(process.cwd(), parseBenchmarkArgs(args.slice(1)));
    const benchmark = await runIntentBenchmark(fixturePath);
    console.log(JSON.stringify(benchmark, null, 2));
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
    confirmedRequirementIds: options.confirmedRequirementIds,
  });

  const { report } = result;
  console.log(`\nAgentShip review: ${report.verdict}`);
  console.log(`Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.timedOut} timed out, ${report.summary.skipped} skipped`);
  console.log(`Changed files: ${report.repository.changedFiles.length}`);
  console.log(`Evidence: ${path.relative(process.cwd(), result.jsonPath)}`);
  console.log(`Report: ${path.relative(process.cwd(), result.markdownPath)}`);
  console.log(`SARIF: ${path.relative(process.cwd(), result.sarifPath)}`);

  if (report.mode === "gate" && report.verdict === "BLOCK") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`AgentShip review failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
