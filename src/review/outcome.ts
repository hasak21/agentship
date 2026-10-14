import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_REPORT_FINDINGS = 10_000;
const MAX_OUTCOME_FILES = 10_000;
const MAX_OUTCOME_BYTES = 256 * 1024;

export type FindingOutcomeStatus =
  | "accepted"
  | "rejected"
  | "fixed"
  | "overridden";

export interface FindingOutcome {
  schemaVersion: 1;
  id: string;
  status: FindingOutcomeStatus;
  actor: string;
  reason: string;
  recordedAt: string;
  triageDurationMs: number;
  finding: {
    id: string;
    kind: string;
    severity: "blocker" | "warning";
    title: string;
  };
  sourceReport: ReportBinding;
  resolutionReport?: ReportBinding;
  evidence: "human_disposition" | "finding_absent" | "retained_override";
}

export interface MissedFindingLabel {
  schemaVersion: 1;
  id: string;
  actor: string;
  reason: string;
  recordedAt: string;
  finding: {
    id: string;
    kind: string;
    severity: "blocker" | "warning";
    title: string;
  };
  sourceReport: ReportBinding;
  evidence: "human_missed_finding_label";
}

export interface OutcomeMetrics {
  schemaVersion: 1;
  directory: string;
  outcomes: number;
  byStatus: Record<FindingOutcomeStatus, number>;
  dispositions: {
    valid: number;
    rejected: number;
    precision: number | null;
    coverage: number;
  };
  blockers: {
    outcomes: number;
    rejected: number;
    falseBlockRate: number | null;
  };
  reviewCorpus?: {
    directory: string;
    reports: number;
    reportsWithOutcomes: number;
    falseBlockedReviews: number;
    falseBlocksPer100Reviews: number;
  };
  triageDurationMs: {
    median: number | null;
    p90: number | null;
  };
  recall?: {
    labelsDirectory: string;
    validEmittedFindings: number;
    missedFindings: number;
    recall: number | null;
  };
  limitations: string[];
}

interface ReportBinding {
  path: string;
  sha256: string;
  runId: string;
  finishedAt: string;
  repository: {
    head: string;
    diffSha256: string;
    reviewScope: "working-tree" | "staged" | "base";
    base?: string;
  };
  configurationSha256: string;
  taskSha256?: string;
}

interface ParsedFinding {
  id: string;
  kind: string;
  severity: "blocker" | "warning";
  title: string;
  overridden: boolean;
}

interface ParsedReport {
  binding: ReportBinding;
  findings: ParsedFinding[];
}

export interface RecordFindingOutcomeOptions {
  repositoryRoot: string;
  reportPath: string;
  findingId: string;
  findingKind: string;
  status: FindingOutcomeStatus;
  actor: string;
  reason: string;
  outputDirectory?: string;
  resolutionReportPath?: string;
}

export interface RecordMissedFindingOptions {
  repositoryRoot: string;
  reportPath: string;
  findingId: string;
  findingKind: string;
  severity: "blocker" | "warning";
  title: string;
  actor: string;
  reason: string;
  outputDirectory?: string;
}

export async function recordMissedFinding(
  options: RecordMissedFindingOptions,
  recordedAt = new Date(),
  labelId: string = randomUUID()
): Promise<{ label: MissedFindingLabel; outputPath: string }> {
  if (Number.isNaN(recordedAt.getTime())) {
    throw new Error("Missed-finding recordedAt must be a valid date.");
  }
  const repositoryRoot = await realpath(options.repositoryRoot);
  const reportPath = repositoryRelativePath(options.reportPath, "Missed-finding report path");
  const report = await loadReport(repositoryRoot, reportPath, "Missed-finding source report");
  const findingId = boundedString(options.findingId, "Missed-finding id", 128);
  const findingKind = boundedString(options.findingKind, "Missed-finding kind", 128);
  if (report.findings.some(({ id, kind }) => id === findingId && kind === findingKind)) {
    throw new Error("Missed-finding target is already present in the source report.");
  }
  if (options.severity !== "blocker" && options.severity !== "warning") {
    throw new Error("Missed-finding severity must be blocker or warning.");
  }
  const label: MissedFindingLabel = {
    schemaVersion: 1,
    id: stableId(labelId, "Missed-finding label id"),
    actor: boundedString(options.actor, "Missed-finding actor", 128),
    reason: boundedString(options.reason, "Missed-finding reason", 1024),
    recordedAt: recordedAt.toISOString(),
    finding: {
      id: findingId,
      kind: findingKind,
      severity: options.severity,
      title: boundedString(options.title, "Missed-finding title", 512),
    },
    sourceReport: report.binding,
    evidence: "human_missed_finding_label",
  };
  const outputDirectory = repositoryRelativePath(
    options.outputDirectory ?? ".agentship/missed-findings",
    "Missed-finding output directory"
  );
  const absoluteDirectory = path.resolve(repositoryRoot, outputDirectory);
  await mkdir(absoluteDirectory, { recursive: true });
  const resolvedDirectory = await realpath(absoluteDirectory);
  assertInsideRepository(repositoryRoot, resolvedDirectory, "Missed-finding output directory");
  const outputPath = path.join(
    resolvedDirectory,
    `${label.recordedAt.replaceAll(":", "-")}-${label.id}.json`
  );
  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(label, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return { label, outputPath: path.relative(repositoryRoot, outputPath) };
}

export async function recordFindingOutcome(
  options: RecordFindingOutcomeOptions,
  recordedAt = new Date(),
  outcomeId: string = randomUUID()
): Promise<{ outcome: FindingOutcome; outputPath: string }> {
  if (Number.isNaN(recordedAt.getTime())) {
    throw new Error("Outcome recordedAt must be a valid date.");
  }
  const repositoryRoot = await realpath(options.repositoryRoot);
  if (!["accepted", "rejected", "fixed", "overridden"].includes(options.status)) {
    throw new Error("Outcome status must be accepted, rejected, fixed, or overridden.");
  }
  const reportPath = repositoryRelativePath(options.reportPath, "Outcome report path");
  const report = await loadReport(repositoryRoot, reportPath, "Outcome source report");
  const findingId = boundedString(options.findingId, "Outcome finding id", 128);
  const findingKind = boundedString(options.findingKind, "Outcome finding kind", 128);
  const finding = report.findings.find(
    (entry) => entry.id === findingId && entry.kind === findingKind
  );
  if (!finding) {
    throw new Error(`Outcome target '${findingId}' and '${findingKind}' is absent from the source report.`);
  }

  const actor = boundedString(options.actor, "Outcome actor", 128);
  const reason = boundedString(options.reason, "Outcome reason", 1024);
  let resolutionReport: ReportBinding | undefined;
  let evidence: FindingOutcome["evidence"] = "human_disposition";

  if (options.status === "fixed") {
    if (!options.resolutionReportPath) {
      throw new Error("A fixed outcome requires --resolution-report.");
    }
    const resolutionPath = repositoryRelativePath(
      options.resolutionReportPath,
      "Outcome resolution report path"
    );
    const resolution = await loadReport(
      repositoryRoot,
      resolutionPath,
      "Outcome resolution report"
    );
    assertCompatibleReports(report.binding, resolution.binding);
    if (
      resolution.findings.some(
        (entry) => entry.id === findingId && entry.kind === findingKind
      )
    ) {
      throw new Error("Fixed outcome target is still present in the resolution report.");
    }
    resolutionReport = resolution.binding;
    evidence = "finding_absent";
  } else if (options.resolutionReportPath) {
    throw new Error("--resolution-report is only valid for a fixed outcome.");
  }

  if (options.status === "overridden") {
    if (!finding.overridden) {
      throw new Error("Overridden outcome requires retained override evidence on the source finding.");
    }
    evidence = "retained_override";
  }

  const recordedAtIso = recordedAt.toISOString();
  const sourceFinishedAt = Date.parse(report.binding.finishedAt);
  const outcome: FindingOutcome = {
    schemaVersion: 1,
    id: stableId(outcomeId, "Outcome id"),
    status: options.status,
    actor,
    reason,
    recordedAt: recordedAtIso,
    triageDurationMs: Math.max(0, recordedAt.getTime() - sourceFinishedAt),
    finding: {
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      title: finding.title,
    },
    sourceReport: report.binding,
    ...(resolutionReport ? { resolutionReport } : {}),
    evidence,
  };

  const outputDirectory = repositoryRelativePath(
    options.outputDirectory ?? ".agentship/outcomes",
    "Outcome output directory"
  );
  const absoluteDirectory = path.resolve(repositoryRoot, outputDirectory);
  await mkdir(absoluteDirectory, { recursive: true });
  const resolvedDirectory = await realpath(absoluteDirectory);
  assertInsideRepository(repositoryRoot, resolvedDirectory, "Outcome output directory");
  const timestamp = recordedAtIso.replaceAll(":", "-");
  const absoluteOutputPath = path.join(
    resolvedDirectory,
    `${timestamp}-${outcome.id}.json`
  );
  const handle = await open(absoluteOutputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(outcome, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return {
    outcome,
    outputPath: path.relative(repositoryRoot, absoluteOutputPath),
  };
}

export async function measureFindingOutcomes(
  repositoryRootInput: string,
  directoryInput = ".agentship/outcomes",
  reportsDirectoryInput?: string,
  missedFindingsDirectoryInput?: string
): Promise<OutcomeMetrics> {
  const repositoryRoot = await realpath(repositoryRootInput);
  const directory = repositoryRelativePath(directoryInput, "Outcome metrics directory");
  const absoluteDirectory = path.resolve(repositoryRoot, directory);
  assertInsideRepository(repositoryRoot, absoluteDirectory, "Outcome metrics directory");
  const resolvedDirectory = await realpath(absoluteDirectory);
  assertInsideRepository(repositoryRoot, resolvedDirectory, "Outcome metrics directory");
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  if (jsonFiles.length > MAX_OUTCOME_FILES) {
    throw new Error(`Outcome metrics directory exceeds ${MAX_OUTCOME_FILES} JSON files.`);
  }

  const outcomes: FindingOutcome[] = [];
  const targets = new Set<string>();
  for (const entry of jsonFiles.sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(resolvedDirectory, entry.name);
    const handle = await open(filePath, "r");
    try {
      const stats = await handle.stat();
      if (stats.size > MAX_OUTCOME_BYTES) {
        throw new Error(`Outcome file '${entry.name}' exceeds ${MAX_OUTCOME_BYTES} bytes.`);
      }
      const source = await handle.readFile();
      if (source.length > MAX_OUTCOME_BYTES) {
        throw new Error(`Outcome file '${entry.name}' exceeds ${MAX_OUTCOME_BYTES} bytes.`);
      }
      const outcome = parseOutcome(
        parseJsonObject(source.toString("utf8"), `Outcome file '${entry.name}'`),
        `Outcome file '${entry.name}'`
      );
      const target = `${outcome.sourceReport.sha256}\0${outcome.finding.id}\0${outcome.finding.kind}`;
      if (targets.has(target)) {
        throw new Error(`Outcome file '${entry.name}' duplicates a source finding disposition.`);
      }
      targets.add(target);
      outcomes.push(outcome);
    } finally {
      await handle.close();
    }
  }

  const byStatus: Record<FindingOutcomeStatus, number> = {
    accepted: 0,
    rejected: 0,
    fixed: 0,
    overridden: 0,
  };
  for (const outcome of outcomes) byStatus[outcome.status]++;
  const valid = byStatus.accepted + byStatus.fixed;
  const dispositionCount = valid + byStatus.rejected;
  const blockers = outcomes.filter(({ finding }) => finding.severity === "blocker");
  const rejectedBlockers = blockers.filter(({ status }) => status === "rejected").length;
  const durations = outcomes.map(({ triageDurationMs }) => triageDurationMs).sort((a, b) => a - b);
  const reviewCorpus = reportsDirectoryInput
    ? await measureReviewCorpus(repositoryRoot, reportsDirectoryInput, outcomes)
    : undefined;
  const missedFindingLabels = missedFindingsDirectoryInput
    ? await loadMissedFindingLabels(
        repositoryRoot,
        missedFindingsDirectoryInput,
        reportsDirectoryInput
      )
    : undefined;

  return {
    schemaVersion: 1,
    directory,
    outcomes: outcomes.length,
    byStatus,
    dispositions: {
      valid,
      rejected: byStatus.rejected,
      precision: dispositionCount === 0 ? null : valid / dispositionCount,
      coverage: outcomes.length === 0 ? 0 : dispositionCount / outcomes.length,
    },
    blockers: {
      outcomes: blockers.length,
      rejected: rejectedBlockers,
      falseBlockRate: blockers.length === 0 ? null : rejectedBlockers / blockers.length,
    },
    ...(reviewCorpus ? { reviewCorpus } : {}),
    triageDurationMs: {
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
    },
    ...(missedFindingLabels
      ? {
          recall: {
            labelsDirectory: missedFindingLabels.directory,
            validEmittedFindings: valid,
            missedFindings: missedFindingLabels.labels.length,
            recall:
              valid + missedFindingLabels.labels.length === 0
                ? null
                : valid / (valid + missedFindingLabels.labels.length),
          },
        }
      : {}),
    limitations: [
      "Precision uses accepted and fixed outcomes as valid dispositions, rejected outcomes as false positives, and excludes overrides.",
      ...(reviewCorpus
        ? ["False blocks per 100 reviews counts distinct corpus reports with at least one rejected blocker outcome."]
        : ["False-block rate is the share of blocker outcomes marked rejected; provide a review corpus to measure false blocks per 100 reviews."]),
      ...(missedFindingLabels
        ? ["Recall treats accepted and fixed emitted findings as true positives and supplied human missed-finding labels as false negatives."]
        : ["Outcome records cannot measure missed findings or recall unless a missed-finding label directory is supplied."]),
      "Actor identity and local outcome provenance are not authenticated in schema version 1.",
    ],
  };
}

async function loadMissedFindingLabels(
  repositoryRoot: string,
  directoryInput: string,
  reportsDirectoryInput?: string
): Promise<{ directory: string; labels: MissedFindingLabel[] }> {
  if (!reportsDirectoryInput) throw new Error("Missed-finding metrics require --reports.");
  const reportsDirectory = repositoryRelativePath(reportsDirectoryInput, "Review metrics directory");
  const reportsAbsoluteDirectory = await realpath(path.resolve(repositoryRoot, reportsDirectory));
  assertInsideRepository(repositoryRoot, reportsAbsoluteDirectory, "Review metrics directory");
  const reportEntries = (await readdir(reportsAbsoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const corpusHashes = new Set<string>();
  for (const entry of reportEntries) {
    const report = await loadReport(
      repositoryRoot,
      path.posix.join(reportsDirectory, entry.name),
      `Review corpus file '${entry.name}'`
    );
    corpusHashes.add(report.binding.sha256);
  }
  const directory = repositoryRelativePath(directoryInput, "Missed-finding metrics directory");
  const absoluteDirectory = path.resolve(repositoryRoot, directory);
  assertInsideRepository(repositoryRoot, absoluteDirectory, "Missed-finding metrics directory");
  const resolvedDirectory = await realpath(absoluteDirectory);
  assertInsideRepository(repositoryRoot, resolvedDirectory, "Missed-finding metrics directory");
  const entries = (await readdir(resolvedDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  if (entries.length > MAX_OUTCOME_FILES) {
    throw new Error(`Missed-finding metrics directory exceeds ${MAX_OUTCOME_FILES} JSON files.`);
  }
  const labels: MissedFindingLabel[] = [];
  const identities = new Set<string>();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(resolvedDirectory, entry.name);
    const handle = await open(filePath, "r");
    try {
      const stats = await handle.stat();
      if (stats.size > MAX_OUTCOME_BYTES) throw new Error(`Missed-finding file '${entry.name}' exceeds ${MAX_OUTCOME_BYTES} bytes.`);
      const value = parseJsonObject((await handle.readFile()).toString("utf8"), `Missed-finding file '${entry.name}'`);
      const label = parseMissedFinding(value, `Missed-finding file '${entry.name}'`);
      if (!corpusHashes.has(label.sourceReport.sha256)) {
        throw new Error(`Missed-finding file '${entry.name}' source report is absent from the review corpus.`);
      }
      const report = await loadReport(repositoryRoot, label.sourceReport.path, `Missed-finding file '${entry.name}' source report`);
      if (report.binding.sha256 !== label.sourceReport.sha256) throw new Error(`Missed-finding file '${entry.name}' source report hash does not match.`);
      if (report.findings.some(({ id, kind }) => id === label.finding.id && kind === label.finding.kind)) {
        throw new Error(`Missed-finding file '${entry.name}' target is present in its source report.`);
      }
      const identity = `${label.sourceReport.sha256}\0${label.finding.id}\0${label.finding.kind}`;
      if (identities.has(identity)) throw new Error(`Missed-finding file '${entry.name}' duplicates a label.`);
      identities.add(identity);
      labels.push(label);
    } finally {
      await handle.close();
    }
  }
  return { directory, labels };
}

function parseMissedFinding(value: Record<string, unknown>, label: string): MissedFindingLabel {
  if (value.schemaVersion !== 1) throw new Error(`${label} must declare schemaVersion: 1.`);
  if (value.evidence !== "human_missed_finding_label") throw new Error(`${label} evidence is invalid.`);
  const finding = objectField(value.finding, `${label} finding`);
  if (finding.severity !== "blocker" && finding.severity !== "warning") throw new Error(`${label} finding.severity is invalid.`);
  return {
    schemaVersion: 1,
    id: stableId(value.id, `${label} id`),
    actor: boundedString(value.actor, `${label} actor`, 128),
    reason: boundedString(value.reason, `${label} reason`, 1024),
    recordedAt: isoDate(value.recordedAt, `${label} recordedAt`),
    finding: {
      id: boundedString(finding.id, `${label} finding.id`, 128),
      kind: boundedString(finding.kind, `${label} finding.kind`, 128),
      severity: finding.severity,
      title: boundedString(finding.title, `${label} finding.title`, 512),
    },
    sourceReport: parseOutcomeBinding(value.sourceReport, `${label} sourceReport`),
    evidence: "human_missed_finding_label",
  };
}

async function measureReviewCorpus(
  repositoryRoot: string,
  directoryInput: string,
  outcomes: FindingOutcome[]
): Promise<NonNullable<OutcomeMetrics["reviewCorpus"]>> {
  const directory = repositoryRelativePath(directoryInput, "Review metrics directory");
  const absoluteDirectory = path.resolve(repositoryRoot, directory);
  assertInsideRepository(repositoryRoot, absoluteDirectory, "Review metrics directory");
  const resolvedDirectory = await realpath(absoluteDirectory);
  assertInsideRepository(repositoryRoot, resolvedDirectory, "Review metrics directory");
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  if (jsonFiles.length > MAX_OUTCOME_FILES) {
    throw new Error(`Review metrics directory exceeds ${MAX_OUTCOME_FILES} JSON files.`);
  }

  const reportHashes = new Set<string>();
  for (const entry of jsonFiles.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(directory, entry.name);
    const report = await loadReport(repositoryRoot, relativePath, `Review corpus file '${entry.name}'`);
    if (reportHashes.has(report.binding.sha256)) {
      throw new Error(`Review corpus file '${entry.name}' duplicates report bytes.`);
    }
    reportHashes.add(report.binding.sha256);
  }

  const outcomeReportHashes = new Set(outcomes.map(({ sourceReport }) => sourceReport.sha256));
  const missing = [...outcomeReportHashes].filter((hash) => !reportHashes.has(hash));
  if (missing.length > 0) {
    throw new Error(
      `Review corpus is missing ${missing.length} source report${missing.length === 1 ? "" : "s"} referenced by outcomes.`
    );
  }
  const falseBlockedReports = new Set(
    outcomes
      .filter(({ status, finding }) => status === "rejected" && finding.severity === "blocker")
      .map(({ sourceReport }) => sourceReport.sha256)
  );
  return {
    directory,
    reports: reportHashes.size,
    reportsWithOutcomes: outcomeReportHashes.size,
    falseBlockedReviews: falseBlockedReports.size,
    falseBlocksPer100Reviews:
      reportHashes.size === 0 ? 0 : (falseBlockedReports.size / reportHashes.size) * 100,
  };
}

function parseOutcome(value: Record<string, unknown>, label: string): FindingOutcome {
  if (value.schemaVersion !== 1) throw new Error(`${label} must declare schemaVersion: 1.`);
  const status = value.status;
  if (status !== "accepted" && status !== "rejected" && status !== "fixed" && status !== "overridden") {
    throw new Error(`${label} status is invalid.`);
  }
  const finding = objectField(value.finding, `${label} finding`);
  const severity = finding.severity;
  if (severity !== "blocker" && severity !== "warning") {
    throw new Error(`${label} finding.severity is invalid.`);
  }
  const sourceReport = parseOutcomeBinding(value.sourceReport, `${label} sourceReport`);
  const triageDurationMs = value.triageDurationMs;
  if (!Number.isSafeInteger(triageDurationMs) || (triageDurationMs as number) < 0) {
    throw new Error(`${label} triageDurationMs must be a non-negative safe integer.`);
  }
  const evidence = value.evidence;
  if (evidence !== "human_disposition" && evidence !== "finding_absent" && evidence !== "retained_override") {
    throw new Error(`${label} evidence is invalid.`);
  }
  if ((status === "fixed") !== (evidence === "finding_absent")) {
    throw new Error(`${label} fixed status and evidence are inconsistent.`);
  }
  if ((status === "overridden") !== (evidence === "retained_override")) {
    throw new Error(`${label} overridden status and evidence are inconsistent.`);
  }
  if ((status === "fixed") !== (value.resolutionReport !== undefined)) {
    throw new Error(`${label} fixed status and resolution report are inconsistent.`);
  }
  return {
    schemaVersion: 1,
    id: stableId(value.id, `${label} id`),
    status,
    actor: boundedString(value.actor, `${label} actor`, 128),
    reason: boundedString(value.reason, `${label} reason`, 1024),
    recordedAt: isoDate(value.recordedAt, `${label} recordedAt`),
    triageDurationMs: triageDurationMs as number,
    finding: {
      id: boundedString(finding.id, `${label} finding.id`, 128),
      kind: boundedString(finding.kind, `${label} finding.kind`, 128),
      severity,
      title: boundedString(finding.title, `${label} finding.title`, 512),
    },
    sourceReport,
    ...(value.resolutionReport === undefined
      ? {}
      : { resolutionReport: parseOutcomeBinding(value.resolutionReport, `${label} resolutionReport`) }),
    evidence,
  };
}

function parseOutcomeBinding(value: unknown, label: string): ReportBinding {
  const binding = objectField(value, label);
  const repository = objectField(binding.repository, `${label} repository`);
  const reviewScope = repository.reviewScope;
  if (reviewScope !== "working-tree" && reviewScope !== "staged" && reviewScope !== "base") {
    throw new Error(`${label} repository.reviewScope is invalid.`);
  }
  return {
    path: repositoryRelativePath(binding.path, `${label} path`),
    sha256: sha256String(binding.sha256, `${label} sha256`),
    runId: boundedString(binding.runId, `${label} runId`, 128),
    finishedAt: isoDate(binding.finishedAt, `${label} finishedAt`),
    repository: {
      head: boundedString(repository.head, `${label} repository.head`, 256),
      diffSha256: sha256String(repository.diffSha256, `${label} repository.diffSha256`),
      reviewScope,
      ...(repository.base === undefined ? {} : { base: boundedString(repository.base, `${label} repository.base`, 256) }),
    },
    configurationSha256: sha256String(binding.configurationSha256, `${label} configurationSha256`),
    ...(binding.taskSha256 === undefined ? {} : { taskSha256: sha256String(binding.taskSha256, `${label} taskSha256`) }),
  };
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function loadReport(
  repositoryRoot: string,
  reportPath: string,
  label: string
): Promise<ParsedReport> {
  const absolutePath = path.resolve(repositoryRoot, reportPath);
  assertInsideRepository(repositoryRoot, absolutePath, `${label} path`);
  const resolvedPath = await realpath(absolutePath);
  assertInsideRepository(repositoryRoot, resolvedPath, `${label} path`);
  const handle = await open(resolvedPath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
    if (stats.size > MAX_REPORT_BYTES) {
      throw new Error(`${label} exceeds ${MAX_REPORT_BYTES} bytes.`);
    }
    const source = await handle.readFile();
    if (source.length > MAX_REPORT_BYTES) {
      throw new Error(`${label} exceeds ${MAX_REPORT_BYTES} bytes.`);
    }
    const value = parseJsonObject(source.toString("utf8"), label);
    const parsed = parseReport(value, label);
    parsed.binding.path = reportPath;
    parsed.binding.sha256 = createHash("sha256").update(source).digest("hex");
    return parsed;
  } finally {
    await handle.close();
  }
}

function parseReport(report: Record<string, unknown>, label: string): ParsedReport {
  if (report.schemaVersion !== 1) {
    throw new Error(`${label} must declare schemaVersion: 1.`);
  }
  const repository = objectField(report.repository, `${label} repository`);
  const configuration = objectField(report.configuration, `${label} configuration`);
  const reviewScope = repository.reviewScope;
  if (reviewScope !== "working-tree" && reviewScope !== "staged" && reviewScope !== "base") {
    throw new Error(`${label} repository.reviewScope is invalid.`);
  }
  const finishedAt = isoDate(report.finishedAt, `${label} finishedAt`);
  const binding: ReportBinding = {
    path: "",
    sha256: "",
    runId: boundedString(report.runId, `${label} runId`, 128),
    finishedAt,
    repository: {
      head: boundedString(repository.head, `${label} repository.head`, 256),
      diffSha256: sha256String(repository.diffSha256, `${label} repository.diffSha256`),
      reviewScope,
      ...(repository.base === undefined
        ? {}
        : { base: boundedString(repository.base, `${label} repository.base`, 256) }),
    },
    configurationSha256: sha256String(
      configuration.sha256,
      `${label} configuration.sha256`
    ),
    ...(report.task
      ? {
          taskSha256: sha256String(
            objectField(report.task, `${label} task`).sha256,
            `${label} task.sha256`
          ),
        }
      : {}),
  };
  if (!Array.isArray(report.findings)) {
    throw new Error(`${label} findings must be an array.`);
  }
  if (report.findings.length > MAX_REPORT_FINDINGS) {
    throw new Error(`${label} exceeds ${MAX_REPORT_FINDINGS} findings.`);
  }
  const findings = report.findings.map<ParsedFinding>((value, index) => {
    const finding = objectField(value, `${label} findings[${index}]`);
    const severity = finding.severity;
    if (severity !== "blocker" && severity !== "warning") {
      throw new Error(`${label} findings[${index}].severity is invalid.`);
    }
    let overridden = false;
    if (finding.override !== undefined) {
      const override = objectField(
        finding.override,
        `${label} findings[${index}].override`
      );
      boundedString(override.id, `${label} findings[${index}].override.id`, 64);
      boundedString(override.actor, `${label} findings[${index}].override.actor`, 128);
      boundedString(override.reason, `${label} findings[${index}].override.reason`, 512);
      boundedString(
        override.expiresAt,
        `${label} findings[${index}].override.expiresAt`,
        10
      );
      sha256String(
        override.reportSha256,
        `${label} findings[${index}].override.reportSha256`
      );
      overridden = true;
    }
    return {
      id: boundedString(finding.id, `${label} findings[${index}].id`, 128),
      kind: boundedString(finding.kind, `${label} findings[${index}].kind`, 128),
      severity,
      title: boundedString(finding.title, `${label} findings[${index}].title`, 512),
      overridden,
    };
  });
  const identities = new Set<string>();
  for (const finding of findings) {
    const identity = `${finding.id}\0${finding.kind}`;
    if (identities.has(identity)) {
      throw new Error(`${label} contains a duplicate finding identity.`);
    }
    identities.add(identity);
  }
  return { binding, findings };
}

function assertCompatibleReports(source: ReportBinding, resolution: ReportBinding): void {
  if (
    source.configurationSha256 !== resolution.configurationSha256 ||
    source.taskSha256 !== resolution.taskSha256 ||
    source.repository.reviewScope !== resolution.repository.reviewScope ||
    source.repository.base !== resolution.repository.base
  ) {
    throw new Error(
      "Resolution report must use the same configuration, task, review scope, and base."
    );
  }
  if (Date.parse(resolution.finishedAt) <= Date.parse(source.finishedAt)) {
    throw new Error("Resolution report must be newer than the source report.");
  }
  if (
    source.repository.head === resolution.repository.head &&
    source.repository.diffSha256 === resolution.repository.diffSha256
  ) {
    throw new Error("Resolution report must describe a changed repository state.");
  }
}

function repositoryRelativePath(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 512);
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
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
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
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
  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== candidate) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp.`);
  }
  return candidate;
}
