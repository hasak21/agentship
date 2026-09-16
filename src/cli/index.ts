#!/usr/bin/env node
import path from "node:path";
import { runReview } from "../review/review";

interface CliOptions {
  taskPath?: string;
  configPath?: string;
  base?: string;
  staged: boolean;
  outputPath?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { staged: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (index === 0 && arg === "review") continue;
    if (arg === "--staged") {
      options.staged = true;
      continue;
    }
    if (["--task", "--config", "--base", "--output"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--task") options.taskPath = value;
      if (arg === "--config") options.configPath = value;
      if (arg === "--base") options.base = value;
      if (arg === "--output") options.outputPath = value;
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
  npm run review -- [options]

Options:
  --task <path>    Task or requirements document to bind to the report
  --base <ref>     Review committed changes since the merge base with <ref>
  --staged         Review staged changes instead of the working tree
  --config <path>  Configuration path (default: .agentship.yml)
  --output <path>  JSON report path
  -h, --help       Show this help`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runReview({
    cwd: process.cwd(),
    taskPath: options.taskPath,
    configPath: options.configPath,
    base: options.base,
    staged: options.staged,
    outputPath: options.outputPath,
  });

  const { report } = result;
  console.log(`\nAgentShip review: ${report.verdict}`);
  console.log(`Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.timedOut} timed out`);
  console.log(`Changed files: ${report.repository.changedFiles.length}`);
  console.log(`Evidence: ${path.relative(process.cwd(), result.jsonPath)}`);
  console.log(`Report: ${path.relative(process.cwd(), result.markdownPath)}`);

  if (report.mode === "gate" && report.verdict === "BLOCK") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`AgentShip review failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
