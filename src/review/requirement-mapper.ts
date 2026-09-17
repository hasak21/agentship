import type { TaskRequirement } from "./task-parser";
import type { CheckStatus } from "./types";

export interface RequirementCheckEvidence {
  name: string;
  status: CheckStatus | "not_configured";
}

export type InferredFileRole = "test" | "documentation";

export interface RequirementRoleEvidence {
  role: InferredFileRole;
  observedFiles: string[];
}

export interface SymbolReference {
  path: string;
  symbol: string;
}

export interface RequirementSymbolEvidence extends SymbolReference {
  status: "changed" | "file_unchanged" | "symbol_not_in_diff" | "diff_unavailable";
}

export interface RequirementMapping {
  requirementId: string;
  basis:
    | "explicit_path"
    | "explicit_check"
    | "explicit_path_and_check"
    | "explicit_symbol"
    | "explicit_mixed"
    | "inferred_file_role"
    | "none";
  references: string[];
  observedFiles: string[];
  missingReferences: string[];
  checkReferences: string[];
  checkEvidence: RequirementCheckEvidence[];
  symbolReferences: SymbolReference[];
  symbolEvidence: RequirementSymbolEvidence[];
  inferredRoles: InferredFileRole[];
  roleEvidence: RequirementRoleEvidence[];
  missingRoles: InferredFileRole[];
  status:
    | "observed"
    | "missing"
    | "inferred_observed"
    | "inferred_missing"
    | "unmapped";
}

export interface ChangeCoverage {
  attributedFiles: string[];
  unattributedFiles: string[];
}

export function mapRequirementsToChangedFiles(
  requirements: TaskRequirement[],
  changedFiles: string[],
  checks: Array<{ name: string; status: CheckStatus }> = [],
  diff = ""
): RequirementMapping[] {
  const changedLinesByFile = collectChangedLinesByFile(diff);
  return requirements.map((requirement) => {
    const references = extractPathReferences(requirement.text);
    const checkReferences = extractCheckReferences(requirement.text);
    const symbolReferences = extractSymbolReferences(requirement.text);
    const inferredRoles = inferExpectedFileRoles(requirement.text).filter(
      (role) => !references.some((reference) => pathHasRole(reference, role))
    );
    if (
      references.length === 0 &&
      checkReferences.length === 0 &&
      symbolReferences.length === 0 &&
      inferredRoles.length === 0
    ) {
      return {
        requirementId: requirement.id,
        basis: "none",
        references: [],
        observedFiles: [],
        missingReferences: [],
        checkReferences: [],
        checkEvidence: [],
        symbolReferences: [],
        symbolEvidence: [],
        inferredRoles: [],
        roleEvidence: [],
        missingRoles: [],
        status: "unmapped",
      };
    }

    const filesByReference = references.map((reference) => ({
      reference,
      files: changedFiles.filter((file) => pathMatches(reference, file)),
    }));
    const observedFiles = [
      ...new Set(filesByReference.flatMap(({ files }) => files)),
    ];
    const missingReferences = filesByReference
      .filter(({ files }) => files.length === 0)
      .map(({ reference }) => reference);
    const checkEvidence = checkReferences.map((name) => ({
      name,
      status: combinedCheckStatus(checks.filter((check) => check.name === name)),
    }));
    const checksSatisfied = checkEvidence.every(({ status }) => status === "passed");
    const symbolEvidence = symbolReferences.map((reference) =>
      mapSymbolEvidence(reference, changedFiles, changedLinesByFile)
    );
    const symbolsSatisfied = symbolEvidence.every(({ status }) => status === "changed");
    const roleEvidence = inferredRoles.map((role) => ({
      role,
      observedFiles: changedFiles.filter((file) => pathHasRole(file, role)),
    }));
    const missingRoles = roleEvidence
      .filter(({ observedFiles: files }) => files.length === 0)
      .map(({ role }) => role);
    const explicitKinds = [
      references.length > 0,
      checkReferences.length > 0,
      symbolReferences.length > 0,
    ].filter(Boolean).length;
    const hasExplicitEvidence = explicitKinds > 0;
    const explicitEvidenceSatisfied =
      missingReferences.length === 0 && checksSatisfied && symbolsSatisfied;
    return {
      requirementId: requirement.id,
      basis:
        explicitKinds > 1
          ? references.length > 0 && checkReferences.length > 0 && symbolReferences.length === 0
            ? "explicit_path_and_check"
            : "explicit_mixed"
          : references.length > 0
            ? "explicit_path"
            : checkReferences.length > 0
              ? "explicit_check"
              : symbolReferences.length > 0
                ? "explicit_symbol"
                : "inferred_file_role",
      references,
      observedFiles,
      missingReferences,
      checkReferences,
      checkEvidence,
      symbolReferences,
      symbolEvidence,
      inferredRoles,
      roleEvidence,
      missingRoles,
      status:
        hasExplicitEvidence && !explicitEvidenceSatisfied
          ? "missing"
          : missingRoles.length > 0
            ? "inferred_missing"
            : hasExplicitEvidence
              ? "observed"
              : "inferred_observed",
    };
  });
}

export function summarizeChangeCoverage(
  mappings: RequirementMapping[],
  changedFiles: string[],
  excludedFiles: string[] = []
): ChangeCoverage {
  const attributed = new Set(
    mappings.flatMap((mapping) => mapping.observedFiles)
  );
  const excluded = new Set(excludedFiles);
  return {
    attributedFiles: changedFiles.filter(
      (file) => !excluded.has(file) && attributed.has(file)
    ),
    unattributedFiles: changedFiles.filter(
      (file) => !excluded.has(file) && !attributed.has(file)
    ),
  };
}

export function extractPathReferences(text: string): string[] {
  const candidates = [...text.matchAll(/(?<!`)`change:([^`\n]+)`(?!`)/g)].map((match) =>
    match[1].trim()
  );
  return [...new Set(candidates.filter(isLikelyRepositoryPath).map(normalizePath))];
}

export function extractCheckReferences(text: string): string[] {
  const candidates = [...text.matchAll(/(?<!`)`check:([^`\n]+)`(?!`)/g)].map((match) =>
    match[1].trim()
  );
  return [...new Set(candidates.filter((name) => name.length > 0))];
}

export function extractSymbolReferences(text: string): SymbolReference[] {
  const candidates = [...text.matchAll(/(?<!`)`symbol:([^`\n]+)`(?!`)/g)]
    .map((match) => match[1].trim())
    .map((value) => {
      const separator = value.lastIndexOf("#");
      if (separator <= 0) return undefined;
      const path = normalizePath(value.slice(0, separator).trim());
      const symbol = value.slice(separator + 1).trim();
      if (!isLikelyRepositoryPath(path) || !/^[A-Za-z_$][\w$]*$/.test(symbol)) {
        return undefined;
      }
      return { path, symbol };
    })
    .filter((reference): reference is SymbolReference => reference !== undefined);
  return [
    ...new Map(candidates.map((reference) => [
      `${reference.path}#${reference.symbol}`,
      reference,
    ])).values(),
  ];
}

export function inferExpectedFileRoles(text: string): InferredFileRole[] {
  const roles: InferredFileRole[] = [];
  const testTarget = String.raw`(?:tests?|test\s+coverage|coverage)`;
  const documentationTarget = String.raw`(?:document(?:ation|ing)?|docs?|readme|guide|changelog)`;
  const testIntent = new RegExp(
    String.raw`\b(?:add|create|write|update|extend|include|cover)\b[^.!?\n]{0,80}\b${testTarget}\b`,
    "i"
  );
  const documentationIntent = new RegExp(
    String.raw`(?:\bdocument\b|\b(?:add|create|write|update|extend|include)\b[^.!?\n]{0,80}\b${documentationTarget}\b)`,
    "i"
  );
  if (testIntent.test(text) && !hasNegatedTarget(text, testTarget)) roles.push("test");
  if (
    documentationIntent.test(text) &&
    !hasNegatedTarget(text, documentationTarget)
  ) {
    roles.push("documentation");
  }
  return roles;
}

function combinedCheckStatus(
  checks: Array<{ status: CheckStatus }>
): RequirementCheckEvidence["status"] {
  if (checks.length === 0) return "not_configured";
  if (checks.some(({ status }) => status === "timed_out")) return "timed_out";
  if (checks.some(({ status }) => status === "failed")) return "failed";
  return "passed";
}

function collectChangedLinesByFile(diff: string): Map<string, string[]> {
  const changedLines = new Map<string, string[]>();
  let currentPath: string | undefined;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      currentPath = header[2];
      changedLines.set(currentPath, []);
      inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ") && currentPath) {
      const path = line.replace(/^\+\+\+\s+(?:b\/)?/, "").trim();
      if (path !== "/dev/null" && path !== currentPath) {
        const existing = changedLines.get(currentPath) ?? [];
        changedLines.delete(currentPath);
        currentPath = path;
        changedLines.set(currentPath, existing);
      }
      continue;
    }
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (
      currentPath &&
      inHunk &&
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---")
    ) {
      changedLines.get(currentPath)?.push(line.slice(1));
    }
  }
  return changedLines;
}

function mapSymbolEvidence(
  reference: SymbolReference,
  changedFiles: string[],
  changedLinesByFile: Map<string, string[]>
): RequirementSymbolEvidence {
  if (!changedFiles.includes(reference.path)) {
    return { ...reference, status: "file_unchanged" };
  }
  const lines = changedLinesByFile.get(reference.path);
  if (!lines) return { ...reference, status: "diff_unavailable" };
  const escaped = reference.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`);
  return {
    ...reference,
    status: lines.some((line) => token.test(line))
      ? "changed"
      : "symbol_not_in_diff",
  };
}

function isLikelyRepositoryPath(value: string): boolean {
  return (
    !value.includes(" ") &&
    (value.includes("/") || /\.[a-z0-9]+$/i.test(value)) &&
    !value.includes("://")
  );
}

function normalizePath(value: string): string {
  return value.replace(/^\.\//, "").replace(/\\/g, "/");
}

function hasNegatedTarget(text: string, target: string): boolean {
  return new RegExp(
    String.raw`\b(?:do\s+not|don't|without|avoid)\b[^.!?\n]{0,60}\b${target}\b`,
    "i"
  ).test(text);
}

function pathHasRole(path: string, role: InferredFileRole): boolean {
  const normalized = normalizePath(path).toLowerCase();
  if (role === "test") {
    return (
      /(^|\/)(?:__tests__|tests?|spec)(?:\/|$)/.test(normalized) ||
      /\.(?:test|spec)\.[^/]+$/.test(normalized)
    );
  }
  return (
    /(^|\/)docs?(?:\/|$)/.test(normalized) ||
    /(^|\/)(?:readme|changelog)(?:\.[^/]+)?$/.test(normalized) ||
    /\.(?:md|mdx|rst|adoc)$/.test(normalized)
  );
}

export function pathMatches(reference: string, file: string): boolean {
  if (reference.endsWith("/**")) {
    const prefix = reference.slice(0, -3).replace(/\/$/, "");
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  return file === reference;
}
