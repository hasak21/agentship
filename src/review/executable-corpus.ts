import type { SeededOmissionCase } from "./intent-evaluator";
import type { CheckStatus } from "./types";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_CORPUS_BYTES = 1024 * 1024;
const MAX_DIFF_LINES_PER_FILE = 1_000;

export type FileOracle =
  | { type: "file_exists"; path: string }
  | { type: "file_absent"; path: string }
  | { type: "file_contains"; path: string; value: string }
  | { type: "file_not_contains"; path: string; value: string };

export interface ExecutablePatchCase {
  id: string;
  category: string;
  requirement: string;
  rationale: string;
  baseFiles: Record<string, string>;
  patch: Record<string, string | null>;
  checks?: Array<{ name: string; status: CheckStatus }>;
  oracle: FileOracle[];
}

export interface ExecutableCorpus {
  schemaVersion: 1;
  kind: "executable_patch";
  cases: ExecutablePatchCase[];
}

export interface OracleAssertionResult {
  type: FileOracle["type"];
  path: string;
  passed: boolean;
}

export interface ExecutedPatchCase {
  evaluationCase: SeededOmissionCase;
  oracle: {
    passed: boolean;
    assertions: OracleAssertionResult[];
  };
}

export function parseExecutableCorpus(value: unknown): ExecutableCorpus {
  if (!value || typeof value !== "object") {
    throw new Error("Executable corpus must be an object.");
  }
  const corpus = value as Record<string, unknown>;
  if (corpus.schemaVersion !== 1 || corpus.kind !== "executable_patch") {
    throw new Error(
      "Executable corpus must declare schemaVersion: 1 and kind: executable_patch."
    );
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    throw new Error("Executable corpus cases must be a non-empty array.");
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  const cases = corpus.cases.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Executable case ${index + 1} must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    for (const field of ["id", "category", "requirement", "rationale"] as const) {
      if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
        throw new Error(
          `Executable case ${index + 1}.${field} must be a non-empty string.`
        );
      }
    }
    const id = candidate.id as string;
    if (ids.has(id)) throw new Error(`Executable case id '${id}' is duplicated.`);
    ids.add(id);
    const baseFiles = parseFileMap(candidate.baseFiles, id, false);
    const patch = parseFileMap(candidate.patch, id, true);
    for (const content of [
      ...Object.values(baseFiles),
      ...Object.values(patch).filter((item): item is string => item !== null),
    ]) {
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_FILE_BYTES) {
        throw new Error(`Executable case ${id} contains a file over ${MAX_FILE_BYTES} bytes.`);
      }
      totalBytes += bytes;
    }
    if (totalBytes > MAX_CORPUS_BYTES) {
      throw new Error(`Executable corpus content exceeds ${MAX_CORPUS_BYTES} bytes.`);
    }
    if (!Array.isArray(candidate.oracle) || candidate.oracle.length === 0) {
      throw new Error(`Executable case ${id}.oracle must be a non-empty array.`);
    }
    const oracle = candidate.oracle.map((assertion, assertionIndex) =>
      parseOracle(assertion, id, assertionIndex)
    );
    return {
      id,
      category: candidate.category as string,
      requirement: candidate.requirement as string,
      rationale: candidate.rationale as string,
      baseFiles,
      patch,
      checks: parseChecks(candidate.checks, id),
      oracle,
    };
  });
  return { schemaVersion: 1, kind: "executable_patch", cases };
}

export function executePatchCase(fixture: ExecutablePatchCase): ExecutedPatchCase {
  const files = new Map(Object.entries(fixture.baseFiles));
  for (const [path, content] of Object.entries(fixture.patch)) {
    if (content === null) files.delete(path);
    else files.set(path, content);
  }
  const changedFiles = Object.keys(fixture.patch)
    .filter((path) => fixture.baseFiles[path] !== fixture.patch[path])
    .sort();
  const assertions = fixture.oracle.map((assertion): OracleAssertionResult => {
    const content = files.get(assertion.path);
    let passed: boolean;
    if (assertion.type === "file_exists") passed = content !== undefined;
    else if (assertion.type === "file_absent") passed = content === undefined;
    else if (assertion.type === "file_contains") {
      passed = content?.includes(assertion.value) ?? false;
    } else {
      passed = content === undefined || !content.includes(assertion.value);
    }
    return { type: assertion.type, path: assertion.path, passed };
  });
  const oraclePassed = assertions.every(({ passed }) => passed);
  return {
    evaluationCase: {
      id: fixture.id,
      category: fixture.category,
      requirement: fixture.requirement,
      changedFiles,
      checks: fixture.checks,
      diff: buildUnifiedDiff(fixture.baseFiles, fixture.patch, changedFiles),
      omissionExpected: !oraclePassed,
      rationale: fixture.rationale,
    },
    oracle: { passed: oraclePassed, assertions },
  };
}

function parseFileMap(
  value: unknown,
  caseId: string,
  allowDeletion: false
): Record<string, string>;
function parseFileMap(
  value: unknown,
  caseId: string,
  allowDeletion: true
): Record<string, string | null>;
function parseFileMap(
  value: unknown,
  caseId: string,
  allowDeletion: boolean
): Record<string, string | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Executable case ${caseId} file map must be an object.`);
  }
  const result: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(value as Record<string, unknown>)) {
    assertRepositoryPath(path, caseId);
    if (typeof content !== "string" && !(allowDeletion && content === null)) {
      throw new Error(`Executable case ${caseId} file '${path}' has invalid content.`);
    }
    result[path] = content as string | null;
  }
  return result;
}

function parseOracle(value: unknown, caseId: string, index: number): FileOracle {
  if (!value || typeof value !== "object") {
    throw new Error(`Executable case ${caseId}.oracle[${index}] must be an object.`);
  }
  const assertion = value as Record<string, unknown>;
  if (
    !["file_exists", "file_absent", "file_contains", "file_not_contains"].includes(
      String(assertion.type)
    )
  ) {
    throw new Error(`Executable case ${caseId}.oracle[${index}].type is invalid.`);
  }
  if (typeof assertion.path !== "string") {
    throw new Error(`Executable case ${caseId}.oracle[${index}].path is required.`);
  }
  assertRepositoryPath(assertion.path, caseId);
  if (assertion.type === "file_contains" || assertion.type === "file_not_contains") {
    if (typeof assertion.value !== "string" || !assertion.value) {
      throw new Error(`Executable case ${caseId}.oracle[${index}].value is required.`);
    }
    return {
      type: assertion.type,
      path: assertion.path,
      value: assertion.value,
    };
  }
  return { type: assertion.type as "file_exists" | "file_absent", path: assertion.path };
}

function parseChecks(
  value: unknown,
  caseId: string
): Array<{ name: string; status: CheckStatus }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Executable case ${caseId}.checks must be an array.`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Executable case ${caseId}.checks[${index}] must be an object.`);
    }
    const check = entry as Record<string, unknown>;
    if (typeof check.name !== "string" || !check.name.trim()) {
      throw new Error(`Executable case ${caseId}.checks[${index}].name is required.`);
    }
    if (!(["passed", "failed", "timed_out"] as unknown[]).includes(check.status)) {
      throw new Error(`Executable case ${caseId}.checks[${index}].status is invalid.`);
    }
    return { name: check.name, status: check.status as CheckStatus };
  });
}

function assertRepositoryPath(path: string, caseId: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path === ".." ||
    path.startsWith("../") ||
    path.includes("/../") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new Error(`Executable case ${caseId} path '${path}' must be repository-relative.`);
  }
}

function buildUnifiedDiff(
  baseFiles: Record<string, string>,
  patch: Record<string, string | null>,
  changedFiles: string[]
): string {
  return changedFiles
    .map((path) => {
      const before = baseFiles[path];
      const after = patch[path];
      const beforeLines = splitContent(before);
      const afterLines = splitContent(after ?? undefined);
      if (
        beforeLines.length > MAX_DIFF_LINES_PER_FILE ||
        afterLines.length > MAX_DIFF_LINES_PER_FILE
      ) {
        throw new Error(`Executable diff for '${path}' exceeds ${MAX_DIFF_LINES_PER_FILE} lines.`);
      }
      const operations = diffLines(beforeLines, afterLines);
      return [
        `diff --git a/${path} b/${path}`,
        before === undefined ? "--- /dev/null" : `--- a/${path}`,
        after === null ? "+++ /dev/null" : `+++ b/${path}`,
        `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
        ...operations,
      ].join("\n");
    })
    .join("\n");
}

function splitContent(content: string | undefined): string[] {
  if (content === undefined || content === "") return [];
  return content.replace(/\n$/, "").split("\n");
}

function diffLines(before: string[], after: string[]): string[] {
  const lengths = Array.from({ length: before.length + 1 }, () =>
    new Uint16Array(after.length + 1)
  );
  for (let left = before.length - 1; left >= 0; left--) {
    for (let right = after.length - 1; right >= 0; right--) {
      lengths[left][right] =
        before[left] === after[right]
          ? lengths[left + 1][right + 1] + 1
          : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const operations: string[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (
      left < before.length &&
      right < after.length &&
      before[left] === after[right]
    ) {
      operations.push(` ${before[left]}`);
      left++;
      right++;
    } else if (
      right < after.length &&
      (left === before.length || lengths[left][right + 1] >= lengths[left + 1][right])
    ) {
      operations.push(`+${after[right++]}`);
    } else {
      operations.push(`-${before[left++]}`);
    }
  }
  return operations;
}
