import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import type {
  OverrideableFindingKind,
  ReviewFinding,
  ReviewReport,
} from "./types";

const MAX_OVERRIDE_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_OVERRIDE_FINDINGS = 100;
const OVERRIDEABLE_KINDS = new Set<OverrideableFindingKind>([
  "required_check_failed",
  "required_check_timed_out",
  "optional_check_failed",
  "explicit_requirement_path_unchanged",
  "explicit_requirement_evidence_unsatisfied",
  "inferred_requirement_role_missing",
  "unattributed_changes",
]);

interface OverrideBinding {
  head: string;
  diffSha256: string;
  configurationSha256: string;
  taskSha256?: string;
}

export type LoadedOverride = NonNullable<ReviewReport["override"]>;

export async function loadOverride(
  repositoryRoot: string,
  overridePath: string,
  binding: OverrideBinding,
  evaluatedAt = new Date()
): Promise<LoadedOverride> {
  const overrideFile = await readBoundedFile(
    path.resolve(repositoryRoot, overridePath),
    MAX_OVERRIDE_BYTES,
    "Override"
  );
  const value = parseJsonObject(overrideFile.source, "Override");
  if (value.schemaVersion !== 1) {
    throw new Error("Override must declare schemaVersion: 1.");
  }
  const id = stableId(value.id, "Override id");
  const actor = boundedString(value.actor, "Override actor", 128);
  const reason = boundedString(value.reason, "Override reason", 512);
  const expiresAt = validDate(value.expiresAt, "Override expiresAt");
  if (expiresAt < evaluatedAt.toISOString().slice(0, 10)) {
    throw new Error(`Override '${id}' expired on ${expiresAt}.`);
  }
  if (!value.report || typeof value.report !== "object") {
    throw new Error("Override report binding is required.");
  }
  const reportBinding = value.report as Record<string, unknown>;
  const reportPath = repositoryRelativePath(
    reportBinding.path,
    "Override report.path"
  );
  const expectedReportSha256 = sha256String(
    reportBinding.sha256,
    "Override report.sha256"
  );
  const findings = parseTargets(value.findings);

  const reportFile = await readBoundedFile(
    path.resolve(repositoryRoot, reportPath),
    MAX_REPORT_BYTES,
    "Override source report"
  );
  if (reportFile.sha256 !== expectedReportSha256) {
    throw new Error("Override source report SHA-256 does not match its declared hash.");
  }
  const report = parseJsonObject(reportFile.source, "Override source report");
  validateSourceReport(report, binding, findings);

  return {
    path: path.relative(repositoryRoot, overrideFile.absolutePath),
    sha256: overrideFile.sha256,
    id,
    actor,
    reason,
    expiresAt,
    sourceReport: {
      path: reportPath,
      sha256: reportFile.sha256,
      runId: boundedString(report.runId, "Override source report runId", 128),
    },
    findings,
  };
}

export function applyOverride(
  findings: ReviewFinding[],
  override: LoadedOverride
): ReviewFinding[] {
  const targets = new Set(
    override.findings.map(({ id, kind }) => findingKey({ id, kind }))
  );
  const currentKeys = new Set(findings.map(findingKey));
  for (const target of targets) {
    if (!currentKeys.has(target)) {
      throw new Error("Override target is absent from the current review findings.");
    }
  }
  return findings.map((finding) =>
    targets.has(findingKey(finding))
      ? {
          ...finding,
          override: {
            id: override.id,
            actor: override.actor,
            reason: override.reason,
            expiresAt: override.expiresAt,
            reportSha256: override.sourceReport.sha256,
          },
        }
      : finding
  );
}

function validateSourceReport(
  report: Record<string, unknown>,
  binding: OverrideBinding,
  targets: LoadedOverride["findings"]
): void {
  if (report.schemaVersion !== 1) {
    throw new Error("Override source report must declare schemaVersion: 1.");
  }
  const repository = objectField(report.repository, "repository");
  const configuration = objectField(report.configuration, "configuration");
  assertEqual(repository.head, binding.head, "repository head");
  assertEqual(repository.diffSha256, binding.diffSha256, "diff SHA-256");
  assertEqual(configuration.sha256, binding.configurationSha256, "configuration SHA-256");
  const sourceTaskSha256 = report.task
    ? objectField(report.task, "task").sha256
    : undefined;
  if (sourceTaskSha256 !== binding.taskSha256) {
    throw new Error("Override source report task SHA-256 does not match the current review.");
  }
  if (!Array.isArray(report.findings)) {
    throw new Error("Override source report findings must be an array.");
  }
  if (report.findings.length > 10_000) {
    throw new Error("Override source report exceeds 10000 findings.");
  }
  const sourceKeys = new Set(
    report.findings.map((finding, index) => {
      const entry = objectField(finding, `findings[${index}]`);
      return findingKey({
        id: boundedString(entry.id, `findings[${index}].id`, 128),
        kind: boundedString(entry.kind, `findings[${index}].kind`, 128),
      });
    })
  );
  for (const target of targets) {
    if (!sourceKeys.has(findingKey(target))) {
      throw new Error(
        `Override target '${target.id}' and '${target.kind}' is absent from the source report.`
      );
    }
  }
}

function parseTargets(value: unknown): LoadedOverride["findings"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Override findings must be a non-empty array.");
  }
  if (value.length > MAX_OVERRIDE_FINDINGS) {
    throw new Error(`Override exceeds ${MAX_OVERRIDE_FINDINGS} findings.`);
  }
  const seen = new Set<string>();
  return value.map((target, index) => {
    const entry = objectField(target, `findings[${index}]`);
    const id = boundedString(entry.id, `findings[${index}].id`, 128);
    const kind = boundedString(entry.kind, `findings[${index}].kind`, 128);
    if (!OVERRIDEABLE_KINDS.has(kind as OverrideableFindingKind)) {
      throw new Error(`Override findings[${index}].kind is not overrideable.`);
    }
    const parsed = { id, kind: kind as OverrideableFindingKind };
    const key = findingKey(parsed);
    if (seen.has(key)) throw new Error("Override contains a duplicate finding target.");
    seen.add(key);
    return parsed;
  });
}

async function readBoundedFile(
  absolutePath: string,
  limit: number,
  label: string
): Promise<{ absolutePath: string; source: string; sha256: string }> {
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
    if (stats.size > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
    const source = await handle.readFile();
    if (source.length > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
    return {
      absolutePath,
      source: source.toString("utf8"),
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  } finally {
    await handle.close();
  }
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

function validDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
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

function sha256String(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function assertEqual(actual: unknown, expected: string, field: string): void {
  if (actual !== expected) {
    throw new Error(`Override source report ${field} does not match the current review.`);
  }
}

function findingKey(finding: { id: string; kind: string }): string {
  return `${finding.id}\0${finding.kind}`;
}
