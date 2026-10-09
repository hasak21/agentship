import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepositoryRoot } from "./git";

const MAX_PACKAGE_BYTES = 1024 * 1024;
const IMMUTABLE_REF = /^[a-f0-9]{40}$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface CiInitializationResult {
  repository: string;
  verifier: { repository: string; ref: string };
  checks: string[];
  files: string[];
}

async function packageChecks(repository: string): Promise<string[]> {
  const packagePath = path.join(repository, "package.json");
  let source: Buffer;
  try {
    source = await readFile(packagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("AgentShip ci-init currently requires package.json scripts.");
    }
    throw error;
  }
  if (source.length === 0 || source.length > MAX_PACKAGE_BYTES) {
    throw new Error(`package.json must contain 1-${MAX_PACKAGE_BYTES} bytes.`);
  }
  const parsed = JSON.parse(source.toString("utf8")) as { scripts?: unknown };
  const scripts = parsed.scripts && typeof parsed.scripts === "object"
    ? parsed.scripts as Record<string, unknown>
    : {};
  const checks = ["lint", "test", "build"].filter(
    (name) => typeof scripts[name] === "string" && scripts[name].trim()
  );
  if (checks.length === 0) {
    throw new Error("package.json must define at least one of lint, test, or build before AgentShip ci-init.");
  }
  return checks;
}

function policy(checks: string[]): string {
  const checkLines = checks.flatMap((name) => [
    `  - name: ${name}`,
    `    run: npm run ${name}`,
    "    required: true",
    `    timeoutSeconds: ${name === "build" ? 180 : 120}`,
    "    isolation: bubblewrap",
    "    network: denied",
    "    resources:",
    `      cpuSeconds: ${name === "build" ? 180 : 120}`,
    "      maxFileSizeMiB: 64",
    "      maxOpenFiles: 1024",
    "",
  ]);
  return [
    "version: 1",
    "mode: report",
    "",
    "limits:",
    "  maxChangedFiles: 500",
    "  maxDiffBytes: 5242880",
    "  maxCheckSeconds: 480",
    "",
    "checks:",
    ...checkLines,
    "policy:",
    "  blockOn:",
    "    - required_check_failed",
    "    - required_check_timed_out",
    "    - explicit_requirement_path_unchanged",
    "    - explicit_requirement_evidence_unsatisfied",
    "  protectedPaths:",
    "    - pattern: .github/workflows/**",
    "      requireManualApproval: true",
    "",
  ].join("\n");
}

function reportCaller(verifierRepository: string, verifierRef: string): string {
  return `name: AgentShip report

on:
  pull_request:

permissions:
  contents: read

jobs:
  report:
    uses: ${verifierRepository}/.github/workflows/agentship-report-reusable.yml@${verifierRef}
    with:
      verifier_repository: ${verifierRepository}
      verifier_ref: ${verifierRef}
`;
}

function publisherCaller(verifierRepository: string, verifierRef: string): string {
  return `name: AgentShip publish check

on:
  workflow_run:
    workflows:
      - AgentShip report
    types:
      - completed

permissions:
  actions: read
  attestations: write
  checks: write
  contents: read
  id-token: write

jobs:
  publish:
    if: >-
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.pull_requests[0].number != null
    uses: ${verifierRepository}/.github/workflows/agentship-publish-check-reusable.yml@${verifierRef}
    with:
      verifier_repository: ${verifierRepository}
      verifier_ref: ${verifierRef}
`;
}

async function ensureLocalDirectory(repository: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(repository, relativePath);
  try {
    const stats = await lstat(absolutePath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${relativePath} must be a real directory inside the repository.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(absolutePath);
  }
}

export async function initializeCi(
  cwd: string,
  verifierRepository: string,
  verifierRef: string
): Promise<CiInitializationResult> {
  if (!GITHUB_REPOSITORY.test(verifierRepository)) {
    throw new Error("--repository must be a GitHub owner/repository name.");
  }
  if (!IMMUTABLE_REF.test(verifierRef)) {
    throw new Error("--ref must be a lowercase, full 40-character commit SHA.");
  }
  const repository = await resolveRepositoryRoot(cwd);
  const checks = await packageChecks(repository);
  for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json"]) {
    try {
      await readFile(path.join(repository, lockfile));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (lockfile === "npm-shrinkwrap.json") {
        throw new Error("AgentShip ci-init requires package-lock.json or npm-shrinkwrap.json for npm ci.");
      }
    }
  }

  const generated = new Map<string, string>([
    [".agentship.ci.yml", policy(checks)],
    [".github/workflows/agentship-report.yml", reportCaller(verifierRepository, verifierRef)],
    [".github/workflows/agentship-publish-check.yml", publisherCaller(verifierRepository, verifierRef)],
  ]);
  for (const relativePath of generated.keys()) {
    try {
      await lstat(path.join(repository, relativePath));
      throw new Error(`${relativePath} already exists; ci-init never overwrites CI trust files.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  await ensureLocalDirectory(repository, ".github");
  await ensureLocalDirectory(repository, ".github/workflows");
  for (const [relativePath, source] of generated) {
    await writeFile(path.join(repository, relativePath), source, { encoding: "utf8", flag: "wx" });
  }
  return {
    repository,
    verifier: { repository: verifierRepository, ref: verifierRef },
    checks,
    files: [...generated.keys()],
  };
}
