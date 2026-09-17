import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

export interface IntentBenchmarkReport {
  schemaVersion: 1;
  corpus: {
    path: string;
    sha256: string;
    cases: number;
    kind: "labeled_scenario" | "executable_patch";
  };
  metrics: ReturnType<typeof evaluateSeededOmissions>;
  results: Array<
    SeededOmissionResult & {
      oracle?: { passed: boolean; assertions: OracleAssertionResult[] };
    }
  >;
}

export async function runIntentBenchmark(
  fixturePath: string
): Promise<IntentBenchmarkReport> {
  const source = await readFile(fixturePath, "utf8");
  const parsed = JSON.parse(source) as unknown;
  let kind: IntentBenchmarkReport["corpus"]["kind"];
  let cases: SeededOmissionCase[];
  const oracleById = new Map<
    string,
    { passed: boolean; assertions: OracleAssertionResult[] }
  >();
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
  } else {
    kind = "labeled_scenario";
    cases = parseSeededOmissionCases(parsed);
  }
  const results = evaluateSeededOmissionCases(cases).map((result) => ({
    ...result,
    ...(oracleById.has(result.id) ? { oracle: oracleById.get(result.id) } : {}),
  }));
  return {
    schemaVersion: 1,
    corpus: {
      path: fixturePath,
      sha256: createHash("sha256").update(source).digest("hex"),
      cases: cases.length,
      kind,
    },
    metrics: evaluateSeededOmissions(cases),
    results,
  };
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
