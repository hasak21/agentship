import type { TaskRequirement } from "./task-parser";

export interface RequirementMapping {
  requirementId: string;
  basis: "explicit_path" | "none";
  references: string[];
  observedFiles: string[];
  status: "observed" | "missing" | "unmapped";
}

export interface ChangeCoverage {
  attributedFiles: string[];
  unattributedFiles: string[];
}

export function mapRequirementsToChangedFiles(
  requirements: TaskRequirement[],
  changedFiles: string[]
): RequirementMapping[] {
  return requirements.map((requirement) => {
    const references = extractPathReferences(requirement.text);
    if (references.length === 0) {
      return {
        requirementId: requirement.id,
        basis: "none",
        references: [],
        observedFiles: [],
        status: "unmapped",
      };
    }

    const observedFiles = changedFiles.filter((file) =>
      references.some((reference) => pathMatches(reference, file))
    );
    return {
      requirementId: requirement.id,
      basis: "explicit_path",
      references,
      observedFiles,
      status: observedFiles.length > 0 ? "observed" : "missing",
    };
  });
}

export function summarizeChangeCoverage(
  mappings: RequirementMapping[],
  changedFiles: string[]
): ChangeCoverage {
  const attributed = new Set(
    mappings.flatMap((mapping) => mapping.observedFiles)
  );
  return {
    attributedFiles: changedFiles.filter((file) => attributed.has(file)),
    unattributedFiles: changedFiles.filter((file) => !attributed.has(file)),
  };
}

export function extractPathReferences(text: string): string[] {
  const candidates = [...text.matchAll(/`change:([^`]+)`/g)].map((match) =>
    match[1].trim()
  );
  return [...new Set(candidates.filter(isLikelyRepositoryPath).map(normalizePath))];
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

function pathMatches(reference: string, file: string): boolean {
  if (reference.endsWith("/**")) {
    const prefix = reference.slice(0, -3).replace(/\/$/, "");
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  return file === reference;
}
