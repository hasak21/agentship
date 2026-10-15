import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import {
  parseExternalEvaluationCorpus,
  type ExternalCorpusProvenance,
  type ExternalEvaluationCorpus,
} from "./intent-benchmark";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_CASES = 10_000;

interface SweBenchTask {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
}

interface SweBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

export interface ImportSweBenchCorpusOptions {
  datasetPath: string;
  predictionsPath: string;
  reportsDirectory: string;
  candidateRun: string;
  evidenceBaseUrl: string;
  provenance: Omit<ExternalCorpusProvenance, "datasetSha256" | "predictionsSha256">;
}

export interface ImportedSweBenchCorpus {
  corpus: ExternalEvaluationCorpus;
  inputs: {
    datasetSha256: string;
    predictionsSha256: string;
    reports: number;
  };
  outcomes: { resolved: number; unresolved: number };
}

export async function importSweBenchCorpus(
  options: ImportSweBenchCorpusOptions
): Promise<ImportedSweBenchCorpus> {
  const datasetInput = await readBoundedFile(options.datasetPath, MAX_INPUT_BYTES, "Dataset");
  const predictionsInput = await readBoundedFile(
    options.predictionsPath,
    MAX_INPUT_BYTES,
    "Predictions"
  );
  const tasks = parseTaskRecords(datasetInput.source, options.datasetPath);
  const predictions = parsePredictionRecords(
    predictionsInput.source,
    options.predictionsPath
  );
  if (predictions.length === 0 || predictions.length > MAX_CASES) {
    throw new Error(`Predictions must contain between 1 and ${MAX_CASES} records.`);
  }

  const taskById = uniqueByInstance(tasks, "dataset");
  const predictionById = uniqueByInstance(predictions, "predictions");
  const candidateRun = boundedText(options.candidateRun, "candidate run", 200);
  const evidenceBaseUrl = credentialFreeHttpsUrl(
    options.evidenceBaseUrl,
    "evidence base URL"
  );
  const reportRoot = path.resolve(options.reportsDirectory);
  let resolved = 0;
  let unresolved = 0;

  const cases = [];
  for (const prediction of predictionById.values()) {
    const task = taskById.get(prediction.instance_id);
    if (!task) {
      throw new Error(`Prediction '${prediction.instance_id}' is absent from the dataset.`);
    }
    const reportPath = path.join(reportRoot, prediction.instance_id, "report.json");
    const reportInput = await readBoundedFile(
      reportPath,
      MAX_REPORT_BYTES,
      `Outcome report '${prediction.instance_id}'`
    );
    const report = parseOutcomeReport(reportInput.source, prediction.instance_id);
    if (report.infra_failure === true) {
      throw new Error(
        `Outcome report '${prediction.instance_id}' is an infrastructure failure, not a candidate verdict.`
      );
    }
    if (report.resolved) resolved++;
    else unresolved++;

    const patchBytes = Buffer.byteLength(prediction.model_patch);
    if (patchBytes > MAX_PATCH_BYTES) {
      throw new Error(`Prediction '${prediction.instance_id}' exceeds ${MAX_PATCH_BYTES} bytes.`);
    }
    const candidate = `${candidateRun}/${boundedText(
      prediction.model_name_or_path,
      `${prediction.instance_id}.model_name_or_path`,
      250
    )}`;
    const outcomeEvidence = new URL(
      `logs/${encodeURIComponent(prediction.instance_id)}/report.json`,
      ensureTrailingSlash(evidenceBaseUrl)
    ).href;
    cases.push({
      id: prediction.instance_id,
      category: report.resolved
        ? "externally evaluated complete change"
        : "externally evaluated incomplete change",
      requirement: boundedText(
        task.problem_statement,
        `${prediction.instance_id}.problem_statement`,
        512 * 1024
      ),
      changedFiles: changedFilesFromPatch(prediction.model_patch, prediction.instance_id),
      diff: prediction.model_patch,
      omissionExpected: !report.resolved,
      rationale: report.resolved
        ? "The external SWE-bench evaluator marked this candidate resolved."
        : "The external SWE-bench evaluator marked this candidate unresolved.",
      source: {
        instanceId: prediction.instance_id,
        repository: task.repo,
        baseCommit: task.base_commit,
        candidate,
        predictionSha256: sha256(prediction.model_patch),
        outcomeSha256: reportInput.sha256,
        outcomeEvidence,
      },
    });
  }

  const corpus = parseExternalEvaluationCorpus({
    schemaVersion: 1,
    kind: "external_evaluation",
    provenance: {
      ...options.provenance,
      datasetSha256: datasetInput.sha256,
      predictionsSha256: predictionsInput.sha256,
    },
    cases,
  });
  return {
    corpus,
    inputs: {
      datasetSha256: datasetInput.sha256,
      predictionsSha256: predictionsInput.sha256,
      reports: cases.length,
    },
    outcomes: { resolved, unresolved },
  };
}

function parseTaskRecords(source: string, filePath: string): SweBenchTask[] {
  const parsed = parseRecords(source, filePath, "dataset");
  if (!Array.isArray(parsed)) {
    throw new Error("dataset must be a JSON array or JSONL file.");
  }
  if (parsed.length > MAX_CASES) {
    throw new Error(`dataset exceeds ${MAX_CASES} records.`);
  }
  return parsed.map((value, index) => {
    const record = objectRecord(value, `Dataset record ${index + 1}`);
    return {
      instance_id: instanceId(record.instance_id, `Dataset record ${index + 1}`),
      repo: boundedText(record.repo, `Dataset record ${index + 1}.repo`, 500),
      base_commit: boundedText(
        record.base_commit,
        `Dataset record ${index + 1}.base_commit`,
        64
      ),
      problem_statement: boundedText(
        record.problem_statement,
        `Dataset record ${index + 1}.problem_statement`,
        512 * 1024
      ),
    };
  });
}

function parsePredictionRecords(source: string, filePath: string): SweBenchPrediction[] {
  const parsed = parseRecords(source, filePath, "predictions");
  const values = Array.isArray(parsed)
    ? parsed
    : Object.values(objectRecord(parsed, "Predictions"));
  return values.map((value, index) => {
    const record = objectRecord(value, `Prediction ${index + 1}`);
    return {
      instance_id: instanceId(record.instance_id, `Prediction ${index + 1}`),
      model_name_or_path: boundedText(
        record.model_name_or_path,
        `Prediction ${index + 1}.model_name_or_path`,
        250
      ),
      model_patch:
        typeof record.model_patch === "string"
          ? record.model_patch
          : (() => {
              throw new Error(`Prediction ${index + 1}.model_patch must be a string.`);
            })(),
    };
  });
}

function parseRecords(
  source: string,
  filePath: string,
  label: string
): unknown[] | Record<string, unknown> {
  if (filePath.toLowerCase().endsWith(".jsonl")) {
    const lines = source.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length > MAX_CASES) {
      throw new Error(`${label} exceeds ${MAX_CASES} records.`);
    }
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`${label} JSONL line ${index + 1} is invalid JSON.`);
      }
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} is invalid JSON.`);
  }
  if (!Array.isArray(parsed) && (!parsed || typeof parsed !== "object")) {
    throw new Error(`${label} must be a JSON array, object, or JSONL file.`);
  }
  return parsed as unknown[] | Record<string, unknown>;
}

function parseOutcomeReport(
  source: string,
  expectedInstanceId: string
): { resolved: boolean; infra_failure: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error(`Outcome report '${expectedInstanceId}' is invalid JSON.`);
  }
  const root = objectRecord(parsed, `Outcome report '${expectedInstanceId}'`);
  const outcome = objectRecord(
    root[expectedInstanceId],
    `Outcome report '${expectedInstanceId}' result`
  );
  if (typeof outcome.resolved !== "boolean") {
    throw new Error(`Outcome report '${expectedInstanceId}' must contain a boolean resolved field.`);
  }
  if (typeof outcome.infra_failure !== "boolean") {
    throw new Error(
      `Outcome report '${expectedInstanceId}' must contain a boolean infra_failure field.`
    );
  }
  return {
    resolved: outcome.resolved,
    infra_failure: outcome.infra_failure,
  };
}

function changedFilesFromPatch(patch: string, instance: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const candidate = match[2];
    if (
      candidate.startsWith("/") ||
      candidate.includes("\\") ||
      candidate.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error(`Prediction '${instance}' contains an unsafe diff path.`);
    }
    files.add(candidate);
  }
  if (patch.trim() && files.size === 0) {
    throw new Error(`Prediction '${instance}' has no parseable git diff headers.`);
  }
  return [...files].sort();
}

function uniqueByInstance<T extends { instance_id: string }>(
  records: T[],
  label: string
): Map<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    if (result.has(record.instance_id)) {
      throw new Error(`${label} instance '${record.instance_id}' is duplicated.`);
    }
    result.set(record.instance_id, record);
  }
  return result;
}

function instanceId(value: unknown, label: string): string {
  const result = boundedText(value, `${label}.instance_id`, 300);
  if (!/^[A-Za-z0-9_.-]+$/.test(result)) {
    throw new Error(`${label}.instance_id contains unsupported path characters.`);
  }
  return result;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be bounded non-empty text.`);
  }
  return value;
}

function credentialFreeHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL.`);
  }
  const immutablePath = parsed.pathname
    .split("/")
    .some((segment) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(segment));
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !immutablePath
  ) {
    throw new Error(
      `${label} must be a credential-free HTTPS URL containing an immutable revision.`
    );
  }
  return parsed.href;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readBoundedFile(
  filePath: string,
  maxBytes: number,
  label: string
): Promise<{ source: string; sha256: string }> {
  const handle = await open(filePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size === 0 || stats.size > maxBytes) {
      throw new Error(`${label} must be a non-empty regular file of at most ${maxBytes} bytes.`);
    }
    const bytes = await handle.readFile();
    if (bytes.length === 0 || bytes.length > maxBytes) {
      throw new Error(`${label} must be a non-empty regular file of at most ${maxBytes} bytes.`);
    }
    return { source: bytes.toString("utf8"), sha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
