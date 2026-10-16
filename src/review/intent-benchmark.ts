import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import {
  executePatchCase,
  parseExecutableCorpus,
  type OracleAssertionResult,
} from "./executable-corpus";
import {
  evaluateSeededOmissionCases,
  evaluateSeededOmissions,
  type SeededOmissionCase,
  type SeededOmissionResult,
} from "./intent-evaluator";
import type { CheckStatus } from "./types";
import { readBoundedRegularFile } from "./bounded-file";
import {
  applyOmissionAdjudications,
  createOmissionAdjudicationPacket,
  MAX_ADJUDICATION_BYTES,
  type AdjudicationCoverage,
  type OmissionAdjudicationCase,
} from "./omission-adjudication";

const MAX_BENCHMARK_BYTES = 5 * 1024 * 1024;

export type BenchmarkLabelSemantics =
  | "declared_omission"
  | "file_oracle_omission"
  | "reviewer_asserted_omission"
  | "task_resolution_proxy";

export interface IntentBenchmarkReport {
  schemaVersion: 1;
  corpus: {
    path: string;
    sha256: string;
    cases: number;
    kind: "labeled_scenario" | "executable_patch" | "external_evaluation";
    labelSemantics: BenchmarkLabelSemantics;
    provenance?: ExternalCorpusProvenance;
    adjudication?: AdjudicationCoverage & { path: string; sha256: string };
  };
  metrics: ReturnType<typeof evaluateSeededOmissions>;
  results: Array<
    SeededOmissionResult & {
      oracle?: { passed: boolean; assertions: OracleAssertionResult[] };
      source?: ExternalCaseSource;
      adjudication?: Pick<OmissionAdjudicationCase, "decision" | "rationale" | "evidence">;
    }
  >;
}

export interface ExternalCorpusProvenance {
  dataset: string;
  revision: string;
  datasetSha256: string;
  predictionsSha256: string;
  split: string;
  sourceUrl: string;
  selection: string;
  retrievedAt: string;
}

export interface ExternalCaseSource {
  instanceId: string;
  repository: string;
  baseCommit: string;
  candidate: string;
  predictionSha256: string;
  outcomeSha256: string;
  outcomeEvidence: string;
}

export interface ExternalEvaluationCorpus {
  schemaVersion: 1;
  kind: "external_evaluation";
  provenance: ExternalCorpusProvenance;
  cases: Array<SeededOmissionCase & { source: ExternalCaseSource }>;
}

export async function runIntentBenchmark(
  fixturePath: string,
  adjudicationPath?: string
): Promise<IntentBenchmarkReport> {
  const source = await readBoundedBenchmark(fixturePath);
  const parsed = JSON.parse(source) as unknown;
  const corpusSha256 = createHash("sha256").update(source).digest("hex");
  let kind: IntentBenchmarkReport["corpus"]["kind"];
  let cases: SeededOmissionCase[];
  const oracleById = new Map<
    string,
    { passed: boolean; assertions: OracleAssertionResult[] }
  >();
  const sourceById = new Map<string, ExternalCaseSource>();
  let provenance: ExternalCorpusProvenance | undefined;
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).kind === "executable_patch"
  ) {
    kind = "executable_patch";
    const corpus = parseExecutableCorpus(parsed);
    const executed = corpus.cases.map(executePatchCase);
    cases = executed.map(({ evaluationCase }) => evaluationCase);
    for (const result of executed) {
      oracleById.set(result.evaluationCase.id, result.oracle);
    }
  } else if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>).kind === "external_evaluation"
  ) {
    kind = "external_evaluation";
    const corpus = parseExternalEvaluationCorpus(parsed);
    provenance = corpus.provenance;
    cases = corpus.cases;
    for (const fixture of corpus.cases) sourceById.set(fixture.id, fixture.source);
  } else {
    kind = "labeled_scenario";
    cases = parseSeededOmissionCases(parsed);
  }
  const totalCases = cases.length;
  let adjudication: IntentBenchmarkReport["corpus"]["adjudication"];
  let decisions: ReturnType<typeof applyOmissionAdjudications>["decisions"] | undefined;
  if (adjudicationPath) {
    if (kind !== "external_evaluation") {
      throw new Error("Adjudications require an external evaluation corpus.");
    }
    const labels = await readBoundedRegularFile(adjudicationPath, "Adjudication packet", MAX_ADJUDICATION_BYTES);
    const applied = applyOmissionAdjudications(
      parseExternalEvaluationCorpus(parsed).cases, corpusSha256, JSON.parse(labels.toString("utf8"))
    );
    cases = applied.cases;
    decisions = applied.decisions;
    adjudication = {
      ...applied.coverage, path: adjudicationPath,
      sha256: createHash("sha256").update(labels).digest("hex"),
    };
  }
  const results = evaluateSeededOmissionCases(cases).map((result) => ({
    ...result,
    ...(oracleById.has(result.id) ? { oracle: oracleById.get(result.id) } : {}),
    ...(sourceById.has(result.id) ? { source: sourceById.get(result.id) } : {}),
    ...(decisions ? { adjudication: decisions.get(result.id) } : {}),
  }));
  return {
    schemaVersion: 1,
    corpus: {
      path: fixturePath,
      sha256: corpusSha256,
      cases: totalCases,
      kind,
      labelSemantics:
        adjudication ? "reviewer_asserted_omission" : kind === "external_evaluation"
          ? "task_resolution_proxy"
          : kind === "executable_patch"
            ? "file_oracle_omission"
            : "declared_omission",
      ...(provenance ? { provenance } : {}),
      ...(adjudication ? { adjudication } : {}),
    },
    metrics: evaluateSeededOmissions(cases),
    results,
  };
}

export async function prepareOmissionAdjudications(fixturePath: string) {
  const source = await readBoundedBenchmark(fixturePath);
  return createOmissionAdjudicationPacket(
    parseExternalEvaluationCorpus(JSON.parse(source)).cases,
    createHash("sha256").update(source).digest("hex")
  );
}

export function parseExternalEvaluationCorpus(value: unknown): ExternalEvaluationCorpus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External evaluation corpus must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || candidate.kind !== "external_evaluation") {
    throw new Error(
      "External evaluation corpus must declare schemaVersion: 1 and kind: external_evaluation."
    );
  }
  if (
    candidate.labelSemantics !== undefined &&
    candidate.labelSemantics !== "task_resolution_proxy"
  ) {
    throw new Error(
      "External evaluation labels must use task_resolution_proxy; task outcomes are not adjudicated requirement omissions."
    );
  }
  const provenance = parseExternalProvenance(candidate.provenance);
  const cases = parseSeededOmissionCases(candidate.cases);
  const rawCases = candidate.cases as Array<Record<string, unknown>>;
  const sourceIds = new Set<string>();
  const externalCases = cases.map((fixture, index) => {
    const source = parseExternalCaseSource(rawCases[index].source, fixture.id);
    const sourceId = `${source.instanceId}\u0000${source.candidate}`;
    if (sourceIds.has(sourceId)) {
      throw new Error(
        `External source '${source.instanceId}' candidate '${source.candidate}' is duplicated.`
      );
    }
    sourceIds.add(sourceId);
    return { ...fixture, source };
  });
  return {
    schemaVersion: 1,
    kind: "external_evaluation",
    provenance,
    cases: externalCases,
  };
}

function parseExternalProvenance(value: unknown): ExternalCorpusProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External corpus provenance must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const result = {} as ExternalCorpusProvenance;
  for (const field of [
    "dataset",
    "revision",
    "datasetSha256",
    "predictionsSha256",
    "split",
    "sourceUrl",
    "selection",
    "retrievedAt",
  ] as const) {
    result[field] = boundedString(candidate[field], `provenance.${field}`, 2_000);
  }
  assertCredentialFreeHttpsUrl(result.sourceUrl, "provenance.sourceUrl");
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.revision)) {
    throw new Error("provenance.revision must be a full 40-character commit or 64-character digest.");
  }
  if (!/^[a-f0-9]{64}$/.test(result.datasetSha256)) {
    throw new Error("provenance.datasetSha256 must be SHA-256.");
  }
  if (!/^[a-f0-9]{64}$/.test(result.predictionsSha256)) {
    throw new Error("provenance.predictionsSha256 must be SHA-256.");
  }
  if (!isCalendarDate(result.retrievedAt)) {
    throw new Error("provenance.retrievedAt must be an ISO calendar date.");
  }
  return result;
}

function parseExternalCaseSource(value: unknown, caseId: string): ExternalCaseSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`External case ${caseId}.source must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  const source = {
    instanceId: boundedString(candidate.instanceId, `${caseId}.source.instanceId`, 500),
    repository: boundedString(candidate.repository, `${caseId}.source.repository`, 500),
    baseCommit: boundedString(candidate.baseCommit, `${caseId}.source.baseCommit`, 64),
    candidate: boundedString(candidate.candidate, `${caseId}.source.candidate`, 500),
    predictionSha256: boundedString(
      candidate.predictionSha256,
      `${caseId}.source.predictionSha256`,
      64
    ),
    outcomeSha256: boundedString(
      candidate.outcomeSha256,
      `${caseId}.source.outcomeSha256`,
      64
    ),
    outcomeEvidence: boundedString(
      candidate.outcomeEvidence,
      `${caseId}.source.outcomeEvidence`,
      2_000
    ),
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository)) {
    throw new Error(`External case ${caseId}.source.repository must be owner/repository.`);
  }
  if (!/^[a-f0-9]{40}$/.test(source.baseCommit)) {
    throw new Error(`External case ${caseId}.source.baseCommit must be a full commit SHA.`);
  }
  if (!/^[a-f0-9]{64}$/.test(source.predictionSha256)) {
    throw new Error(`External case ${caseId}.source.predictionSha256 must be SHA-256.`);
  }
  if (!/^[a-f0-9]{64}$/.test(source.outcomeSha256)) {
    throw new Error(`External case ${caseId}.source.outcomeSha256 must be SHA-256.`);
  }
  assertCredentialFreeHttpsUrl(source.outcomeEvidence, `${caseId}.source.outcomeEvidence`);
  return source;
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must not contain control characters.`);
  }
  return value;
}

function assertCredentialFreeHttpsUrl(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.href.length > 2_000
  ) {
    throw new Error(`${field} must be a credential-free HTTPS URL.`);
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function readBoundedBenchmark(fixturePath: string): Promise<string> {
  const handle = await open(fixturePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_BENCHMARK_BYTES) {
      throw new Error(`Intent benchmark corpus must be a non-empty regular file of at most ${MAX_BENCHMARK_BYTES} bytes.`);
    }
    const source = await handle.readFile();
    if (source.length === 0 || source.length > MAX_BENCHMARK_BYTES) {
      throw new Error(`Intent benchmark corpus must be a non-empty regular file of at most ${MAX_BENCHMARK_BYTES} bytes.`);
    }
    return source.toString("utf8");
  } finally {
    await handle.close();
  }
}

export function parseSeededOmissionCases(value: unknown): SeededOmissionCase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Intent benchmark corpus must be a non-empty array.");
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Corpus case ${index + 1} must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    for (const field of ["id", "category", "requirement", "rationale"] as const) {
      if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
        throw new Error(`Corpus case ${index + 1}.${field} must be a non-empty string.`);
      }
    }
    const id = candidate.id as string;
    if (ids.has(id)) throw new Error(`Corpus case id '${id}' is duplicated.`);
    ids.add(id);
    if (
      !Array.isArray(candidate.changedFiles) ||
      candidate.changedFiles.some(
        (file) => typeof file !== "string" || !file.trim()
      )
    ) {
      throw new Error(`Corpus case ${id}.changedFiles must contain paths.`);
    }
    if (typeof candidate.omissionExpected !== "boolean") {
      throw new Error(`Corpus case ${id}.omissionExpected must be boolean.`);
    }
    if (candidate.diff !== undefined && typeof candidate.diff !== "string") {
      throw new Error(`Corpus case ${id}.diff must be a string.`);
    }
    const checks = parseChecks(candidate.checks, id);
    return {
      id,
      category: candidate.category as string,
      requirement: candidate.requirement as string,
      changedFiles: candidate.changedFiles as string[],
      checks,
      omissionExpected: candidate.omissionExpected,
      rationale: candidate.rationale as string,
      ...(candidate.diff === undefined ? {} : { diff: candidate.diff as string }),
    };
  });
}

function parseChecks(
  value: unknown,
  caseId: string
): Array<{ name: string; status: CheckStatus }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Corpus case ${caseId}.checks must be an array.`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Corpus case ${caseId}.checks[${index}] must be an object.`);
    }
    const check = entry as Record<string, unknown>;
    if (typeof check.name !== "string" || !check.name.trim()) {
      throw new Error(`Corpus case ${caseId}.checks[${index}].name is required.`);
    }
    if (!(["passed", "failed", "timed_out"] as unknown[]).includes(check.status)) {
      throw new Error(`Corpus case ${caseId}.checks[${index}].status is invalid.`);
    }
    return { name: check.name, status: check.status as CheckStatus };
  });
}
