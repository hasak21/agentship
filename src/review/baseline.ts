import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import type {
  BaselineComparison,
  FindingIdentity,
  ReviewFinding,
} from "./types";

const MAX_BASELINE_BYTES = 5 * 1024 * 1024;
const MAX_BASELINE_FINDINGS = 10_000;

interface LoadedBaseline {
  path: string;
  sha256: string;
  runId: string;
  head: string;
  findings: FindingIdentity[];
}

export async function loadBaseline(
  repositoryRoot: string,
  baselinePath: string
): Promise<LoadedBaseline> {
  const absolutePath = path.resolve(repositoryRoot, baselinePath);
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Baseline report must be a regular file.");
    if (stats.size > MAX_BASELINE_BYTES) {
      throw new Error(`Baseline report exceeds ${MAX_BASELINE_BYTES} bytes.`);
    }
    const source = await handle.readFile();
    if (source.length > MAX_BASELINE_BYTES) {
      throw new Error(`Baseline report exceeds ${MAX_BASELINE_BYTES} bytes.`);
    }
    const parsed = parseBaselineReport(source.toString("utf8"));
    return {
      path: path.relative(repositoryRoot, absolutePath),
      sha256: createHash("sha256").update(source).digest("hex"),
      ...parsed,
    };
  } finally {
    await handle.close();
  }
}

export function parseBaselineReport(source: string): Omit<LoadedBaseline, "path" | "sha256"> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Baseline report must contain valid JSON.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Baseline report must be a JSON object.");
  }
  const report = value as Record<string, unknown>;
  if (report.schemaVersion !== 1) {
    throw new Error("Baseline report must declare schemaVersion: 1.");
  }
  const runId = boundedString(report.runId, "runId", 128);
  if (!report.repository || typeof report.repository !== "object") {
    throw new Error("Baseline report repository evidence is required.");
  }
  const head = boundedString(
    (report.repository as Record<string, unknown>).head,
    "repository.head",
    256
  );
  if (!Array.isArray(report.findings)) {
    throw new Error("Baseline report findings must be an array.");
  }
  if (report.findings.length > MAX_BASELINE_FINDINGS) {
    throw new Error(`Baseline report exceeds ${MAX_BASELINE_FINDINGS} findings.`);
  }
  const identities = report.findings.map((finding, index) =>
    parseFindingIdentity(finding, index)
  );
  const keys = new Set<string>();
  for (const identity of identities) {
    const key = findingKey(identity);
    if (keys.has(key)) {
      throw new Error(
        `Baseline report finding '${identity.id}' and '${identity.kind}' is duplicated.`
      );
    }
    keys.add(key);
  }
  return { runId, head, findings: identities };
}

export function compareWithBaseline(
  currentFindings: ReviewFinding[],
  baseline: LoadedBaseline
): BaselineComparison {
  const current = currentFindings.map(toIdentity);
  const currentKeys = new Set(current.map(findingKey));
  const baselineKeys = new Set(baseline.findings.map(findingKey));
  return {
    path: baseline.path,
    sha256: baseline.sha256,
    runId: baseline.runId,
    head: baseline.head,
    newFindings: current.filter((finding) => !baselineKeys.has(findingKey(finding))),
    existingFindings: current.filter((finding) => baselineKeys.has(findingKey(finding))),
    resolvedFindings: baseline.findings.filter(
      (finding) => !currentKeys.has(findingKey(finding))
    ),
  };
}

function parseFindingIdentity(value: unknown, index: number): FindingIdentity {
  if (!value || typeof value !== "object") {
    throw new Error(`Baseline report findings[${index}] must be an object.`);
  }
  const finding = value as Record<string, unknown>;
  const severity = finding.severity;
  if (severity !== "blocker" && severity !== "warning") {
    throw new Error(`Baseline report findings[${index}].severity is invalid.`);
  }
  return {
    id: boundedString(finding.id, `findings[${index}].id`, 128),
    kind: boundedString(finding.kind, `findings[${index}].kind`, 128),
    severity,
  };
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`Baseline report ${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return value;
}

function toIdentity(finding: ReviewFinding): FindingIdentity {
  return { id: finding.id, kind: finding.kind, severity: finding.severity };
}

function findingKey(finding: Pick<FindingIdentity, "id" | "kind">): string {
  return `${finding.id}\0${finding.kind}`;
}
