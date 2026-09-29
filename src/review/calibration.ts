import { createHash } from "node:crypto";
import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { runIntentBenchmark } from "./intent-benchmark";
import type { FindingOutcomeStatus } from "./outcome";

const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_OUTCOME_BYTES = 128 * 1024;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_BENCHMARK_BYTES = 5 * 1024 * 1024;
const MAX_FINDINGS = 10_000;

interface EvidenceFile {
  relativePath: string;
  sha256: string;
  value: Record<string, unknown>;
}

interface IndexedReport {
  sha256: string;
  runId: string;
  finishedAt: string;
  head: string;
  diffSha256: string;
  reviewScope: "working-tree" | "staged" | "base";
  base?: string;
  configurationSha256: string;
  taskSha256?: string;
  findings: Map<string, { severity: "blocker" | "warning"; overridden: boolean }>;
}

interface IndexedOutcome {
  id: string;
  status: FindingOutcomeStatus;
  recordedAt: string;
  triageDurationMs: number;
  finding: {
    id: string;
    kind: string;
    severity: "blocker" | "warning";
  };
  sourceSha256: string;
  sourceRunId: string;
  resolutionSha256?: string;
  resolutionRunId?: string;
}

export interface CalibrationMetricsReport {
  schemaVersion: 1;
  generatedAt: string;
  inputs: {
    outcomes: { directory: string; files: number; sha256: string };
    reports: { directory: string; files: number; sha256: string };
    benchmark: {
      path: string;
      sha256: string;
      kind: "labeled_scenario" | "executable_patch";
      cases: number;
    };
  };
  samples: {
    reviews: number;
    trackedFindings: number;
    adjudicatedFindings: number;
    adjudicatedBlockers: number;
  };
  precision: {
    allFindings: number | null;
    blockers: number | null;
    confirmed: number;
    rejected: number;
  };
  recall: { omissions: number; cases: number };
  falseBlocks: { count: number; per100Reviews: number };
  triage: { samples: number; medianMs: number | null };
  overrides: {
    count: number;
    rate: number;
    subsequentlyAccepted: number;
    subsequentlyRejected: number;
    subsequentlyFixed: number;
  };
}

export interface MeasureCalibrationOptions {
  repositoryRoot: string;
  outcomesDirectory: string;
  reportsDirectory: string;
  benchmarkFixturePath: string;
}

export async function measureCalibration(
  options: MeasureCalibrationOptions,
  generatedAt = new Date()
): Promise<CalibrationMetricsReport> {
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("Calibration generatedAt must be a valid date.");
  }
  const repositoryRoot = await realpath(options.repositoryRoot);
  const outcomeFiles = await readEvidenceDirectory(
    repositoryRoot,
    options.outcomesDirectory,
    MAX_OUTCOME_BYTES,
    "Outcome"
  );
  if (outcomeFiles.length === 0) {
    throw new Error("Calibration requires at least one outcome event.");
  }
  const reportFiles = await readEvidenceDirectory(
    repositoryRoot,
    options.reportsDirectory,
    MAX_REPORT_BYTES,
    "Review report"
  );
  if (reportFiles.length === 0) {
    throw new Error("Calibration requires at least one review report.");
  }

  const reports = new Map<string, IndexedReport>();
  const runIds = new Set<string>();
  for (const file of reportFiles) {
    const report = parseReport(file);
    if (reports.has(report.sha256)) {
      throw new Error("Review report directory contains duplicate report bytes.");
    }
    if (runIds.has(report.runId)) {
      throw new Error(`Review report runId '${report.runId}' is duplicated.`);
    }
    reports.set(report.sha256, report);
    runIds.add(report.runId);
  }

  const outcomes = outcomeFiles.map(parseOutcome);
  const outcomeIds = new Set<string>();
  const grouped = new Map<string, IndexedOutcome[]>();
  for (const outcome of outcomes) {
    if (outcomeIds.has(outcome.id)) {
      throw new Error(`Outcome id '${outcome.id}' is duplicated.`);
    }
    outcomeIds.add(outcome.id);
    const source = reports.get(outcome.sourceSha256);
    if (!source) {
      throw new Error(`Outcome '${outcome.id}' source report is absent from the report set.`);
    }
    if (source.runId !== outcome.sourceRunId) {
      throw new Error(`Outcome '${outcome.id}' source runId does not match its report hash.`);
    }
    const identity = findingKey(outcome.finding.id, outcome.finding.kind);
    const sourceFinding = source.findings.get(identity);
    if (!sourceFinding) {
      throw new Error(`Outcome '${outcome.id}' finding is absent from its source report.`);
    }
    if (sourceFinding.severity !== outcome.finding.severity) {
      throw new Error(`Outcome '${outcome.id}' finding severity does not match its source report.`);
    }
    if (outcome.status === "overridden" && !sourceFinding.overridden) {
      throw new Error(`Outcome '${outcome.id}' has no retained override in its source report.`);
    }
    if (outcome.status === "fixed") {
      const resolution = outcome.resolutionSha256
        ? reports.get(outcome.resolutionSha256)
        : undefined;
      if (!resolution || resolution.runId !== outcome.resolutionRunId) {
        throw new Error(`Outcome '${outcome.id}' resolution report is absent or mismatched.`);
      }
      assertCompatibleResolution(source, resolution);
      if (resolution.findings.has(identity)) {
        throw new Error(`Outcome '${outcome.id}' finding remains in its resolution report.`);
      }
    }
    const groupKey = `${outcome.sourceSha256}\0${identity}`;
    const group = grouped.get(groupKey) ?? [];
    group.push(outcome);
    grouped.set(groupKey, group);
  }

  let confirmed = 0;
  let rejected = 0;
  let blockerConfirmed = 0;
  let blockerRejected = 0;
  let overridden = 0;
  let subsequentlyAccepted = 0;
  let subsequentlyRejected = 0;
  let subsequentlyFixed = 0;
  const triageDurations: number[] = [];

  for (const events of grouped.values()) {
    events.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    const statuses = new Set(events.map(({ status }) => status));
    const hasConfirmed = statuses.has("accepted") || statuses.has("fixed");
    const hasRejected = statuses.has("rejected");
    if (hasConfirmed && hasRejected) {
      throw new Error("A finding has conflicting confirmed and rejected outcomes.");
    }
    const severity = events[0].finding.severity;
    if (events.some((event) => event.finding.severity !== severity)) {
      throw new Error("A finding has conflicting severity across outcome events.");
    }
    if (hasConfirmed) {
      confirmed++;
      if (severity === "blocker") blockerConfirmed++;
    } else if (hasRejected) {
      rejected++;
      if (severity === "blocker") blockerRejected++;
    }
    triageDurations.push(Math.min(...events.map(({ triageDurationMs }) => triageDurationMs)));

    const firstOverride = events.find(({ status }) => status === "overridden");
    if (firstOverride) {
      overridden++;
      const later = new Set(
        events
          .filter(({ recordedAt }) => recordedAt > firstOverride.recordedAt)
          .map(({ status }) => status)
      );
      if (later.has("accepted")) subsequentlyAccepted++;
      if (later.has("rejected")) subsequentlyRejected++;
      if (later.has("fixed")) subsequentlyFixed++;
    }
  }

  const benchmarkPath = await resolveRepositoryFile(
    repositoryRoot,
    options.benchmarkFixturePath,
    "Benchmark fixture",
    MAX_BENCHMARK_BYTES
  );
  const benchmark = await runIntentBenchmark(benchmarkPath.absolutePath);
  const adjudicated = confirmed + rejected;
  const adjudicatedBlockers = blockerConfirmed + blockerRejected;
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    inputs: {
      outcomes: directoryEvidence(options.outcomesDirectory, outcomeFiles),
      reports: directoryEvidence(options.reportsDirectory, reportFiles),
      benchmark: {
        path: benchmarkPath.relativePath,
        sha256: benchmark.corpus.sha256,
        kind: benchmark.corpus.kind,
        cases: benchmark.corpus.cases,
      },
    },
    samples: {
      reviews: reports.size,
      trackedFindings: grouped.size,
      adjudicatedFindings: adjudicated,
      adjudicatedBlockers,
    },
    precision: {
      allFindings: ratioOrNull(confirmed, adjudicated),
      blockers: ratioOrNull(blockerConfirmed, adjudicatedBlockers),
      confirmed,
      rejected,
    },
    recall: {
      omissions: benchmark.metrics.recall,
      cases: benchmark.metrics.cases,
    },
    falseBlocks: {
      count: blockerRejected,
      per100Reviews: (blockerRejected / reports.size) * 100,
    },
    triage: {
      samples: triageDurations.length,
      medianMs: median(triageDurations),
    },
    overrides: {
      count: overridden,
      rate: overridden / grouped.size,
      subsequentlyAccepted,
      subsequentlyRejected,
      subsequentlyFixed,
    },
  };
}

async function readEvidenceDirectory(
  repositoryRoot: string,
  directory: string,
  maxBytes: number,
  label: string
): Promise<EvidenceFile[]> {
  const resolved = await resolveRepositoryDirectory(repositoryRoot, directory, label);
  const entries = await readdir(resolved.absolutePath, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new Error(`${label} directory exceeds ${MAX_DIRECTORY_ENTRIES} entries.`);
  }
  const jsonEntries = entries
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: EvidenceFile[] = [];
  for (const entry of jsonEntries) {
    if (!entry.isFile()) throw new Error(`${label} '${entry.name}' must be a regular file.`);
    const absolutePath = path.join(resolved.absolutePath, entry.name);
    const handle = await open(absolutePath, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > maxBytes) {
        throw new Error(`${label} '${entry.name}' exceeds its file bound.`);
      }
      const source = await handle.readFile();
      if (source.length > maxBytes) {
        throw new Error(`${label} '${entry.name}' exceeds its file bound.`);
      }
      files.push({
        relativePath: path.posix.join(resolved.relativePath, entry.name),
        sha256: createHash("sha256").update(source).digest("hex"),
        value: parseJsonObject(source.toString("utf8"), `${label} '${entry.name}'`),
      });
    } finally {
      await handle.close();
    }
  }
  return files;
}

function parseReport(file: EvidenceFile): IndexedReport {
  const report = file.value;
  if (report.schemaVersion !== 1) {
    throw new Error(`Review report '${file.relativePath}' must declare schemaVersion: 1.`);
  }
  const runId = boundedString(report.runId, "Review report runId", 128);
  const finishedAt = isoDate(report.finishedAt, "Review report finishedAt");
  const repository = objectField(report.repository, "Review report repository");
  const configuration = objectField(report.configuration, "Review report configuration");
  const reviewScope = repository.reviewScope;
  if (reviewScope !== "working-tree" && reviewScope !== "staged" && reviewScope !== "base") {
    throw new Error(`Review report '${file.relativePath}' reviewScope is invalid.`);
  }
  if (!Array.isArray(report.findings) || report.findings.length > MAX_FINDINGS) {
    throw new Error(`Review report '${file.relativePath}' findings are invalid.`);
  }
  const findings = new Map<string, { severity: "blocker" | "warning"; overridden: boolean }>();
  for (const [index, value] of report.findings.entries()) {
    const finding = objectField(value, `Review report findings[${index}]`);
    const identity = findingKey(
      boundedString(finding.id, `Review report findings[${index}].id`, 128),
      boundedString(finding.kind, `Review report findings[${index}].kind`, 128)
    );
    if (findings.has(identity)) throw new Error("Review report has duplicate findings.");
    const severity = finding.severity;
    if (severity !== "blocker" && severity !== "warning") {
      throw new Error(`Review report findings[${index}].severity is invalid.`);
    }
    if (finding.override !== undefined) {
      const override = objectField(finding.override, `Review report findings[${index}].override`);
      boundedString(override.id, `Review report findings[${index}].override.id`, 64);
      boundedString(override.actor, `Review report findings[${index}].override.actor`, 128);
      boundedString(override.reason, `Review report findings[${index}].override.reason`, 512);
      boundedString(override.expiresAt, `Review report findings[${index}].override.expiresAt`, 10);
      sha256String(
        override.reportSha256,
        `Review report findings[${index}].override.reportSha256`
      );
    }
    findings.set(identity, { severity, overridden: finding.override !== undefined });
  }
  return {
    sha256: file.sha256,
    runId,
    finishedAt,
    head: boundedString(repository.head, "Review report repository.head", 256),
    diffSha256: sha256String(repository.diffSha256, "Review report repository.diffSha256"),
    reviewScope,
    ...(repository.base === undefined
      ? {}
      : { base: boundedString(repository.base, "Review report repository.base", 256) }),
    configurationSha256: sha256String(configuration.sha256, "Review report configuration.sha256"),
    ...(report.task
      ? { taskSha256: sha256String(objectField(report.task, "Review report task").sha256, "Review report task.sha256") }
      : {}),
    findings,
  };
}

function parseOutcome(file: EvidenceFile): IndexedOutcome {
  const value = file.value;
  if (value.schemaVersion !== 1) {
    throw new Error(`Outcome '${file.relativePath}' must declare schemaVersion: 1.`);
  }
  const status = value.status;
  if (status !== "accepted" && status !== "rejected" && status !== "fixed" && status !== "overridden") {
    throw new Error(`Outcome '${file.relativePath}' status is invalid.`);
  }
  const evidence = value.evidence;
  const expectedEvidence = status === "fixed"
    ? "finding_absent"
    : status === "overridden"
      ? "retained_override"
      : "human_disposition";
  if (evidence !== expectedEvidence) {
    throw new Error(`Outcome '${file.relativePath}' evidence does not match its status.`);
  }
  if (status === "fixed" && !value.resolutionReport) {
    throw new Error(`Outcome '${file.relativePath}' fixed evidence is incomplete.`);
  }
  const finding = objectField(value.finding, `Outcome '${file.relativePath}' finding`);
  const severity = finding.severity;
  if (severity !== "blocker" && severity !== "warning") {
    throw new Error(`Outcome '${file.relativePath}' severity is invalid.`);
  }
  const source = objectField(value.sourceReport, `Outcome '${file.relativePath}' sourceReport`);
  const resolution = value.resolutionReport
    ? objectField(value.resolutionReport, `Outcome '${file.relativePath}' resolutionReport`)
    : undefined;
  const recordedAt = isoDate(value.recordedAt, `Outcome '${file.relativePath}' recordedAt`);
  const triageDurationMs = nonnegativeInteger(
    value.triageDurationMs,
    `Outcome '${file.relativePath}' triageDurationMs`
  );
  return {
    id: stableId(value.id, `Outcome '${file.relativePath}' id`),
    status,
    recordedAt,
    triageDurationMs,
    finding: {
      id: boundedString(finding.id, "Outcome finding.id", 128),
      kind: boundedString(finding.kind, "Outcome finding.kind", 128),
      severity,
    },
    sourceSha256: sha256String(source.sha256, "Outcome sourceReport.sha256"),
    sourceRunId: boundedString(source.runId, "Outcome sourceReport.runId", 128),
    ...(resolution
      ? {
          resolutionSha256: sha256String(resolution.sha256, "Outcome resolutionReport.sha256"),
          resolutionRunId: boundedString(resolution.runId, "Outcome resolutionReport.runId", 128),
        }
      : {}),
  };
}

function assertCompatibleResolution(source: IndexedReport, resolution: IndexedReport): void {
  if (
    source.configurationSha256 !== resolution.configurationSha256 ||
    source.taskSha256 !== resolution.taskSha256 ||
    source.reviewScope !== resolution.reviewScope ||
    source.base !== resolution.base
  ) {
    throw new Error("Fixed outcome resolution report is not compatible with its source report.");
  }
  if (resolution.finishedAt <= source.finishedAt) {
    throw new Error("Fixed outcome resolution report is not newer than its source report.");
  }
  if (source.head === resolution.head && source.diffSha256 === resolution.diffSha256) {
    throw new Error("Fixed outcome resolution report does not describe a changed state.");
  }
}

function directoryEvidence(
  directory: string,
  files: EvidenceFile[]
): { directory: string; files: number; sha256: string } {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.relativePath).update("\0").update(file.sha256).update("\n");
  return { directory, files: files.length, sha256: hash.digest("hex") };
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function resolveRepositoryDirectory(
  repositoryRoot: string,
  value: string,
  label: string
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = repositoryRelativePath(value, `${label} directory`);
  const absolutePath = await realpath(path.resolve(repositoryRoot, relativePath));
  assertInsideRepository(repositoryRoot, absolutePath, `${label} directory`);
  return { absolutePath, relativePath };
}

async function resolveRepositoryFile(
  repositoryRoot: string,
  value: string,
  label: string,
  maxBytes: number
): Promise<{ absolutePath: string; relativePath: string }> {
  const relativePath = repositoryRelativePath(value, `${label} path`);
  const absolutePath = await realpath(path.resolve(repositoryRoot, relativePath));
  assertInsideRepository(repositoryRoot, absolutePath, `${label} path`);
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    }
  } finally {
    await handle.close();
  }
  return { absolutePath, relativePath };
}

function repositoryRelativePath(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 512);
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`${field} must stay within the repository.`);
  }
  return normalized;
}

function assertInsideRepository(root: string, candidate: string, field: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`${field} must stay within the repository.`);
}

function parseJsonObject(source: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  return objectField(value, label);
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return value;
}

function stableId(value: unknown, field: string): string {
  const id = boundedString(value, field, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`${field} must be a stable identifier up to 64 characters.`);
  }
  return id;
}

function sha256String(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 64);
  if (Number.isNaN(Date.parse(candidate)) || new Date(candidate).toISOString() !== candidate) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp.`);
  }
  return candidate;
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function findingKey(id: string, kind: string): string {
  return `${id}\0${kind}`;
}
