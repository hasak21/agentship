import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { decodeUtf8Input, EvidenceReadBudget } from "./bounded-file";
import { assessCausalBase } from "./causal-evidence";
import type { CheckEvidence, ReviewReport } from "./types";

const MAX_SUBMISSIONS = 100;
const MAX_TASKS = 1_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

interface SubmissionManifest {
  schemaVersion: 1;
  type: "agentship.agent-evaluation";
  submissionId: string;
  agent: { name: string; model: string };
  suite: { id: string; sha256: string };
  tasks: Array<{ id: string; taskSha256: string; report: string; reportSha256: string }>;
}

interface ReviewContext {
  taskId: string;
  configurationSha256: string;
  reviewScope: "working-tree" | "staged" | "base";
  base?: string;
  baseCommit?: string;
}

export interface Leaderboard {
  schemaVersion: 1;
  type: "agentship.trust-leaderboard";
  suite: { id: string; sha256: string; tasks: string[]; reviewContexts: ReviewContext[] };
  submissions: Array<{
    rank: number;
    submissionId: string;
    agent: { name: string; model: string };
    manifest: { path: string; sha256: string };
    metrics: {
      tasks: number;
      pass: number;
      warn: number;
      block: number;
      passRate: number;
      activeBlockers: number;
      causalReproductions: number;
    };
  }>;
  limitations: string[];
}

export async function compileLeaderboard(directory: string): Promise<Leaderboard> {
  const root = await realpath(directory);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".submission.json"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0 || entries.length > MAX_SUBMISSIONS) {
    throw new Error(`Leaderboard requires 1-${MAX_SUBMISSIONS} submission manifests.`);
  }
  const budget = new EvidenceReadBudget("Leaderboard evidence");
  const loaded: Array<{
    name: string;
    manifest: SubmissionManifest;
    metrics: Leaderboard["submissions"][number]["metrics"];
    manifestSha256: string;
    contexts: ReviewContext[];
  }> = [];
  for (const entry of entries) {
    const { name } = entry;
    if (!entry.isFile()) throw new Error(`Leaderboard manifest '${name}' has an invalid file type; it must be a regular file.`);
    const manifestPath = path.join(root, name);
    const source = await readBounded(manifestPath, MAX_MANIFEST_BYTES, budget);
    const manifest = parseManifest(JSON.parse(decodeUtf8Input(source, `Leaderboard evidence '${name}'`)), name);
    const metrics = { tasks: manifest.tasks.length, pass: 0, warn: 0, block: 0, passRate: 0, activeBlockers: 0, causalReproductions: 0 };
    const contexts: ReviewContext[] = [];
    // Keep only scalar metrics, not all parsed reports, and never fan out file I/O.
    for (const task of manifest.tasks) {
      const reportPath = await containedFile(root, task.report);
      const bytes = await readBounded(reportPath, MAX_REPORT_BYTES, budget);
      if (sha256(bytes) !== task.reportSha256) {
        throw new Error(`${name} task '${task.id}' report SHA-256 does not match.`);
      }
      const report: unknown = JSON.parse(decodeUtf8Input(bytes, `Leaderboard evidence '${task.report}'`));
      const context = readReviewContext(report, task.id, name);
      validateReport(report, task, name);
      contexts.push(context);
      if (report.verdict === "PASS") metrics.pass++;
      if (report.verdict === "WARN") metrics.warn++;
      if (report.verdict === "BLOCK") metrics.block++;
      metrics.activeBlockers += report.findings!.filter(
        finding => finding.severity === "blocker" && !finding.suppression && !finding.override
      ).length;
      metrics.causalReproductions += report.checks!.filter(check => check.causal?.satisfied === true).length;
    }
    metrics.passRate = metrics.pass / metrics.tasks;
    contexts.sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
    loaded.push({ name, manifest, metrics, contexts, manifestSha256: sha256(source) });
  }

  const expectedSuite = loaded[0]!.manifest.suite;
  const expectedTaskBindings = loaded[0]!.manifest.tasks
    .map(({ id, taskSha256 }) => `${id}:${taskSha256}`)
    .sort();
  const submissionIds = new Set<string>();
  for (const item of loaded) {
    if (submissionIds.has(item.manifest.submissionId)) {
      throw new Error(`Duplicate submission ID '${item.manifest.submissionId}'.`);
    }
    submissionIds.add(item.manifest.submissionId);
    if (item.manifest.suite.id !== expectedSuite.id || item.manifest.suite.sha256 !== expectedSuite.sha256) {
      throw new Error("All submissions must reference the same suite ID and SHA-256.");
    }
    const tasks = item.manifest.tasks
      .map(({ id, taskSha256 }) => `${id}:${taskSha256}`)
      .sort();
    if (JSON.stringify(tasks) !== JSON.stringify(expectedTaskBindings)) {
      throw new Error("All submissions must contain the same task IDs and task SHA-256 values.");
    }
    if (JSON.stringify(item.contexts) !== JSON.stringify(loaded[0].contexts)) {
      throw new Error("All submissions must use the same review policy and scope (including base reference) for each task.");
    }
  }

  const ranked = loaded.map((item) => ({
      submissionId: item.manifest.submissionId,
      agent: item.manifest.agent,
      manifest: { path: item.name, sha256: item.manifestSha256 },
      metrics: item.metrics,
  })).sort((a, b) =>
    b.metrics.passRate - a.metrics.passRate ||
    a.metrics.activeBlockers - b.metrics.activeBlockers ||
    b.metrics.causalReproductions - a.metrics.causalReproductions ||
    a.submissionId.localeCompare(b.submissionId)
  );

  return {
    schemaVersion: 1,
    type: "agentship.trust-leaderboard",
    suite: {
      ...expectedSuite,
      tasks: expectedTaskBindings.map((binding) => binding.slice(0, binding.indexOf(":"))),
      reviewContexts: loaded[0].contexts,
    },
    submissions: ranked.map((entry, index) => ({ rank: index + 1, ...entry })),
    limitations: [
      "Ranking verifies report bytes and comparability, not report signer or runner authenticity.",
      "PASS rate measures the declared suite and is not representative without an external corpus.",
      "Ties are resolved by active blockers, causal reproductions, then submission ID.",
      "Policy and scope comparability uses recorded configuration hashes and base commits, not authenticated policy execution or runner provenance.",
    ],
  };
}

function parseManifest(value: unknown, name: string): SubmissionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must contain an object.`);
  const manifest = value as Partial<SubmissionManifest>;
  if (manifest.schemaVersion !== 1 || manifest.type !== "agentship.agent-evaluation") throw new Error(`${name} has an unsupported schema or type.`);
  if (!bounded(manifest.submissionId) || !ID.test(manifest.submissionId)) throw new Error(`${name} has an invalid submissionId.`);
  if (!bounded(manifest.agent?.name) || !bounded(manifest.agent?.model)) throw new Error(`${name} has invalid agent identity.`);
  if (!bounded(manifest.suite?.id) || !ID.test(manifest.suite.id) || !bounded(manifest.suite?.sha256) || !SHA256.test(manifest.suite.sha256)) throw new Error(`${name} has invalid suite provenance.`);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0 || manifest.tasks.length > MAX_TASKS) throw new Error(`${name} must contain 1-${MAX_TASKS} tasks.`);
  const ids = new Set<string>();
  for (const task of manifest.tasks) {
    if (!bounded(task?.id) || !ID.test(task.id) || ids.has(task.id)) throw new Error(`${name} has an invalid or duplicate task ID.`);
    ids.add(task.id);
    if (!bounded(task.taskSha256) || !SHA256.test(task.taskSha256) || !bounded(task.reportSha256) || !SHA256.test(task.reportSha256) || !safeRelative(task.report)) throw new Error(`${name} task '${task.id}' has invalid provenance.`);
  }
  return manifest as SubmissionManifest;
}

function validateReport(value: unknown, task: SubmissionManifest["tasks"][number], name: string): asserts value is Partial<ReviewReport> {
  const label = `${name} task '${task.id}'`;
  const report = object(value, label);
  if (report.schemaVersion !== 1 || typeof report.verdict !== "string" || !["PASS", "WARN", "BLOCK"].includes(report.verdict)) throw new Error(`${label} has an invalid report.`);
  if (object(report.task, label).sha256 !== task.taskSha256 || !Array.isArray(report.checks) || !Array.isArray(report.findings)) throw new Error(`${label} report does not bind the expected task.`);
  if (report.findings.length > 10000 || report.checks.length > 128) throw new Error(`${label} has invalid evidence cardinality.`);
  const findings = new Set<string>();
  let activeBlockers = 0;
  let activeFindings = 0;
  for (const value of report.findings) {
    const finding = object(value, label);
    if (!bounded(finding.id) || !bounded(finding.kind) || typeof finding.severity !== "string" || !["blocker", "warning"].includes(finding.severity)) throw new Error(`${label} has an invalid finding.`);
    const identity = `${finding.id}\0${finding.kind}`;
    if (findings.has(identity)) throw new Error(`${label} has duplicate findings.`);
    findings.add(identity);
    for (const key of ["suppression", "override"] as const) {
      if (finding[key] === undefined) continue;
      const disposition = object(finding[key], `${label} ${key}`);
      if (!bounded(disposition.id) || !bounded(disposition[key === "suppression" ? "owner" : "actor"]) ||
          !bounded(disposition.reason, 1024) || !validDate(disposition.expiresAt) ||
          (key === "override" && (typeof disposition.reportSha256 !== "string" || !SHA256.test(disposition.reportSha256)))) {
        throw new Error(`${label} has invalid ${key} evidence.`);
      }
    }
    if (finding.suppression === undefined && finding.override === undefined) {
      activeFindings++;
      if (finding.severity === "blocker") activeBlockers++;
    }
  }
  const expected = activeBlockers ? "BLOCK" : activeFindings ? "WARN" : "PASS";
  if (report.verdict !== expected) throw new Error(`${label} has an inconsistent verdict; findings imply ${expected}.`);
  const checks = new Set<string>();
  for (const value of report.checks) {
    const check = object(value, label);
    if (!bounded(check.name) || !bounded(check.command, 16384) || Buffer.byteLength(check.command) > 16384) throw new Error(`${label} has an invalid check identity.`);
    if (checks.has(check.name as string)) throw new Error(`${label} has duplicate check names.`);
    checks.add(check.name as string);
    validateStatusEvidence(check, label);
    if (check.causal === undefined) continue;
    const causal = object(check.causal, label);
    const base = object(causal.base, label);
    validateStatusEvidence(base, label);
    const paths = (value: unknown, nonempty: boolean) => Array.isArray(value) && (!nonempty || value.length > 0) && value.length <= 256 && value.every(item => bounded(item, 4096));
    if (typeof causal.satisfied !== "boolean" || causal.expectation !== "fails_on_base" ||
        typeof causal.baseCommit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(causal.baseCommit) ||
        !paths(causal.testPaths, true) || !paths(causal.overlaidFiles, false) ||
        check.status !== "passed" || base.name !== check.name || base.command !== check.command) {
      throw new Error(`${label} has invalid causal evidence.`);
    }
    if (object(report.repository, label).baseCommit !== causal.baseCommit) throw new Error(`${label} has inconsistent causal baseline binding.`);
    const assessed = assessCausalBase(base as unknown as CheckEvidence);
    if (causal.satisfied !== assessed.satisfied || (causal.reason !== undefined && causal.reason !== assessed.reason)) {
      throw new Error(`${label} has inconsistent causal evidence.`);
    }
  }
}

function validateStatusEvidence(check: Record<string, unknown>, label: string): void {
  if (typeof check.status !== "string" || !["passed", "failed", "timed_out", "skipped"].includes(check.status) ||
      !(check.exitCode === null || (Number.isInteger(check.exitCode) && Number(check.exitCode) >= 0 && Number(check.exitCode) <= 255)) ||
      !(check.signal === null || (typeof check.signal === "string" && /^SIG[A-Z0-9]+$/.test(check.signal))) ||
      (check.status === "passed" && (check.exitCode !== 0 || check.signal !== null))) {
    throw new Error(`${label} has invalid check status evidence.`);
  }
  if (check.execution === undefined) return;
  const execution = object(check.execution, label);
  if (execution.backend !== undefined && (typeof execution.backend !== "string" || !["direct", "linux-prlimit", "linux-bubblewrap", "unsupported", "not_executed"].includes(execution.backend))) throw new Error(`${label} has invalid execution backend evidence.`);
  if ((execution.backend === "unsupported" || execution.backend === "not_executed") && (check.exitCode !== null || check.signal !== null || check.status === "passed")) throw new Error(`${label} has inconsistent non-execution evidence.`);
  if (execution.cleanupFailed !== undefined && typeof execution.cleanupFailed !== "boolean") throw new Error(`${label} has invalid cleanup evidence.`);
  if (check.status === "passed" && execution.cleanupFailed === true) throw new Error(`${label} has inconsistent cleanup evidence.`);
  if (execution.writableStorage === undefined) return;
  const storage = object(execution.writableStorage, label);
  if (typeof storage.exceeded !== "boolean" || typeof storage.accountingFailed !== "boolean") throw new Error(`${label} has invalid storage evidence.`);
  if (check.status === "passed" && (storage.exceeded || storage.accountingFailed)) throw new Error(`${label} has inconsistent storage evidence.`);
}

function readReviewContext(value: unknown, taskId: string, label: string): ReviewContext {
  const report = object(value, label);
  const configuration = object(report.configuration, `${label} configuration`);
  const repository = object(report.repository, `${label} repository`);
  if (typeof configuration.sha256 !== "string" || !SHA256.test(configuration.sha256) ||
      (repository.reviewScope !== "working-tree" && repository.reviewScope !== "staged" && repository.reviewScope !== "base") ||
      (repository.reviewScope === "base"
        ? !bounded(repository.base, 4096) || typeof repository.baseCommit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(repository.baseCommit)
        : repository.base !== undefined || repository.baseCommit !== undefined)) {
    throw new Error(`${label} has invalid review policy or scope evidence.`);
  }
  return {
    taskId,
    configurationSha256: configuration.sha256,
    reviewScope: repository.reviewScope,
    ...(repository.reviewScope === "base" ? { base: repository.base as string, baseCommit: repository.baseCommit as string } : {}),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} has invalid object evidence.`);
  return value as Record<string, unknown>;
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function containedFile(root: string, relative: string): Promise<string> {
  const candidate = path.resolve(root, relative);
  const resolved = await realpath(candidate);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !(await stat(resolved)).isFile()) throw new Error(`Report path '${relative}' must resolve to a file inside the submissions directory.`);
  return resolved;
}

async function readBounded(file: string, maximum: number, budget: EvidenceReadBudget): Promise<Buffer> {
  const source = await budget.read(file, `Leaderboard evidence '${path.basename(file)}'`, maximum);
  if (source.length === 0) throw new Error(`Leaderboard evidence '${path.basename(file)}' must not be empty.`);
  return source;
}

function safeRelative(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}
function bounded(value: unknown, maximum = 128): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !value.includes("\0"); }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
