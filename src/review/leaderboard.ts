import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ReviewReport } from "./types";

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

export interface Leaderboard {
  schemaVersion: 1;
  type: "agentship.trust-leaderboard";
  suite: { id: string; sha256: string; tasks: string[] };
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
    .filter((entry) => entry.isFile() && entry.name.endsWith(".submission.json"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0 || entries.length > MAX_SUBMISSIONS) {
    throw new Error(`Leaderboard requires 1-${MAX_SUBMISSIONS} submission manifests.`);
  }
  const loaded = await Promise.all(entries.map(async ({ name }) => {
    const manifestPath = path.join(root, name);
    const source = await readBounded(manifestPath, MAX_MANIFEST_BYTES);
    const manifest = parseManifest(JSON.parse(source.toString("utf8")), name);
    const reports = await Promise.all(manifest.tasks.map(async (task) => {
      const reportPath = await containedFile(root, task.report);
      const bytes = await readBounded(reportPath, MAX_REPORT_BYTES);
      if (sha256(bytes) !== task.reportSha256) {
        throw new Error(`${name} task '${task.id}' report SHA-256 does not match.`);
      }
      const report = JSON.parse(bytes.toString("utf8")) as Partial<ReviewReport>;
      validateReport(report, task, name);
      return report as ReviewReport;
    }));
    return { name, manifest, reports, manifestSha256: sha256(source) };
  }));

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
  }

  const ranked = loaded.map((item) => {
    const verdicts = item.reports.map(({ verdict }) => verdict);
    const activeBlockers = item.reports.flatMap(({ findings }) => findings).filter(
      (finding) => finding.severity === "blocker" && !finding.suppression && !finding.override
    ).length;
    const causalReproductions = item.reports.flatMap(({ checks }) => checks).filter(
      (check) => check.causal?.satisfied
    ).length;
    const pass = verdicts.filter((value) => value === "PASS").length;
    return {
      submissionId: item.manifest.submissionId,
      agent: item.manifest.agent,
      manifest: { path: item.name, sha256: item.manifestSha256 },
      metrics: {
        tasks: verdicts.length,
        pass,
        warn: verdicts.filter((value) => value === "WARN").length,
        block: verdicts.filter((value) => value === "BLOCK").length,
        passRate: pass / verdicts.length,
        activeBlockers,
        causalReproductions,
      },
    };
  }).sort((a, b) =>
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
    },
    submissions: ranked.map((entry, index) => ({ rank: index + 1, ...entry })),
    limitations: [
      "Ranking verifies report bytes and comparability, not report signer or runner authenticity.",
      "PASS rate measures the declared suite and is not representative without an external corpus.",
      "Ties are resolved by active blockers, causal reproductions, then submission ID.",
    ],
  };
}

function parseManifest(value: unknown, name: string): SubmissionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must contain an object.`);
  const manifest = value as Partial<SubmissionManifest>;
  if (manifest.schemaVersion !== 1 || manifest.type !== "agentship.agent-evaluation") throw new Error(`${name} has an unsupported schema or type.`);
  if (!ID.test(manifest.submissionId ?? "")) throw new Error(`${name} has an invalid submissionId.`);
  if (!bounded(manifest.agent?.name) || !bounded(manifest.agent?.model)) throw new Error(`${name} has invalid agent identity.`);
  if (!ID.test(manifest.suite?.id ?? "") || !SHA256.test(manifest.suite?.sha256 ?? "")) throw new Error(`${name} has invalid suite provenance.`);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0 || manifest.tasks.length > MAX_TASKS) throw new Error(`${name} must contain 1-${MAX_TASKS} tasks.`);
  const ids = new Set<string>();
  for (const task of manifest.tasks) {
    if (!ID.test(task?.id ?? "") || ids.has(task.id)) throw new Error(`${name} has an invalid or duplicate task ID.`);
    ids.add(task.id);
    if (!SHA256.test(task.taskSha256) || !SHA256.test(task.reportSha256) || !safeRelative(task.report)) throw new Error(`${name} task '${task.id}' has invalid provenance.`);
  }
  return manifest as SubmissionManifest;
}

function validateReport(report: Partial<ReviewReport>, task: SubmissionManifest["tasks"][number], name: string): void {
  if (report.schemaVersion !== 1 || !["PASS", "WARN", "BLOCK"].includes(report.verdict ?? "")) throw new Error(`${name} task '${task.id}' has an invalid report.`);
  if (report.task?.sha256 !== task.taskSha256 || !Array.isArray(report.checks) || !Array.isArray(report.findings)) throw new Error(`${name} task '${task.id}' report does not bind the expected task.`);
}

async function containedFile(root: string, relative: string): Promise<string> {
  const candidate = path.resolve(root, relative);
  const resolved = await realpath(candidate);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !(await stat(resolved)).isFile()) throw new Error(`Report path '${relative}' must resolve to a file inside the submissions directory.`);
  return resolved;
}

async function readBounded(file: string, maximum: number): Promise<Buffer> {
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > maximum) throw new Error(`Evidence file '${path.basename(file)}' exceeds its byte bounds.`);
  return readFile(file);
}

function safeRelative(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}
function bounded(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0"); }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
