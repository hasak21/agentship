import type { TaskRequirement } from "./task-parser";
import type { CheckStatus } from "./types";
import { collectFileDiffEvidence, type FileDiffObservation } from "./git-diff-evidence";
import { extractPathReferences, extractCheckReferences, extractSymbolReferences, type SymbolReference } from "./evidence-annotations";
export { extractPathReferences, extractCheckReferences, extractSymbolReferences, type SymbolReference } from "./evidence-annotations";

export interface RequirementCheckEvidence {
  name: string;
  status: CheckStatus | "not_configured";
}

export type InferredFileRole = "test" | "documentation";

export interface RequirementRoleEvidence {
  role: InferredFileRole;
  observedFiles: string[];
  excludedDeletedFiles?: string[];
  excludedInputFiles?: string[];
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
  diff = "",
  options: { excludedRolePaths?: string[] } = {}
): RequirementMapping[] {
  const changedLinesByFile = collectFileDiffEvidence(diff, changedFiles);
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
    const roleEvidence = inferredRoles.map((role) => {
      const candidates = changedFiles.filter((file) => pathHasRole(file, role));
      const excludedDeletedFiles = candidates.filter((file) => changedLinesByFile.get(file)?.deleted);
      const excludedInputFiles = candidates.filter((file) => options.excludedRolePaths?.includes(file));
      return {
        role,
        observedFiles: candidates.filter((file) =>
          !changedLinesByFile.get(file)?.deleted && !options.excludedRolePaths?.includes(file)
        ),
        ...(excludedDeletedFiles.length ? { excludedDeletedFiles } : {}),
        ...(excludedInputFiles.length ? { excludedInputFiles } : {}),
      };
    });
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

export function inferExpectedFileRoles(text: string): InferredFileRole[] {
  const roles: InferredFileRole[] = [];
  // An action in one clause must not turn a description in the next into a mandate.
  // Spaced dashes separate prose; hyphens within names such as end-to-end stay intact.
  const clauses = text.split(/[.!?;:\r\n]+|\s[-–—]\s/u);
  const testTarget = String.raw`(?:tests?|test\s+coverage|coverage)`;
  const documentationTarget = String.raw`(?:document(?:ation|ing)?|docs?|readme|guide|changelog)`;
  const testIntent = new RegExp(
    String.raw`\b(?:add|create|write|update|extend|include|cover)\b[^.!?\n]{0,80}\b${testTarget}\b`,
    "i"
  );
  const documentationIntent = new RegExp(
    String.raw`(?:(?:^\s*(?:please\s+)?|\b(?:and|then|must|should|shall)\s+)document\s+\S|\b(?:add|create|write|update|extend|include)\b[^.!?\n]{0,80}\b${documentationTarget}\b)`,
    "i"
  );
  if (
    clauses.some((clause) =>
      testIntent.test(clause) && !hasNegatedTarget(clause, testTarget)
    )
  ) roles.push("test");
  if (
    clauses.some((clause) =>
      documentationIntent.test(clause) && !hasNegatedTarget(clause, documentationTarget)
    )
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
  if (checks.some(({ status }) => status === "passed")) return "passed";
  if (checks.some(({ status }) => status === "skipped")) return "skipped";
  return "passed";
}

function mapSymbolEvidence(
  reference: SymbolReference,
  changedFiles: string[],
  changedLinesByFile: Map<string, FileDiffObservation>
): RequirementSymbolEvidence {
  if (!changedFiles.includes(reference.path)) {
    return { ...reference, status: "file_unchanged" };
  }
  const lines = changedLinesByFile.get(reference.path)?.lines;
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
