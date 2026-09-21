import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type {
  AgentShipConfig,
  ReviewCheckConfig,
  ReviewFindingKind,
  SuppressibleFindingKind,
} from "./types";

export const REVIEW_FINDING_KINDS = new Set<ReviewFindingKind>([
  "required_check_failed",
  "required_check_timed_out",
  "optional_check_failed",
  "repository_changed_during_review",
  "explicit_requirement_path_unchanged",
  "explicit_requirement_evidence_unsatisfied",
  "inferred_requirement_role_missing",
  "unattributed_changes",
  "review_budget_exceeded",
  "requirement_confirmation_missing",
  "protected_path_approval_missing",
]);

const SUPPRESSIBLE_FINDING_KINDS = new Set<SuppressibleFindingKind>([
  "optional_check_failed",
  "explicit_requirement_path_unchanged",
  "explicit_requirement_evidence_unsatisfied",
  "inferred_requirement_role_missing",
  "unattributed_changes",
]);

function assertCheck(value: unknown, index: number): asserts value is ReviewCheckConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`checks[${index}] must be an object.`);
  }

  const check = value as Record<string, unknown>;
  if (typeof check.name !== "string" || !check.name.trim()) {
    throw new Error(`checks[${index}].name must be a non-empty string.`);
  }
  if (typeof check.run !== "string" || !check.run.trim()) {
    throw new Error(`checks[${index}].run must be a non-empty string.`);
  }
  if (
    check.timeoutSeconds !== undefined &&
    (typeof check.timeoutSeconds !== "number" || check.timeoutSeconds <= 0)
  ) {
    throw new Error(`checks[${index}].timeoutSeconds must be greater than zero.`);
  }
  if (
    check.environment !== undefined &&
    (!Array.isArray(check.environment) ||
      check.environment.some((name) => typeof name !== "string" || !name.trim()))
  ) {
    throw new Error(`checks[${index}].environment must contain variable names.`);
  }
  if (check.whenChanged !== undefined) {
    if (!Array.isArray(check.whenChanged) || check.whenChanged.length === 0) {
      throw new Error(`checks[${index}].whenChanged must contain path patterns.`);
    }
    check.whenChanged.forEach((pattern, patternIndex) =>
      assertPathPattern(pattern, `checks[${index}].whenChanged[${patternIndex}]`)
    );
  }
}

function assertLimits(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object") {
    throw new Error("limits must be an object.");
  }
  const limits = value as Record<string, unknown>;
  for (const name of ["maxChangedFiles", "maxDiffBytes"] as const) {
    const limit = limits[name];
    if (
      limit !== undefined &&
      (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)
    ) {
      throw new Error(`limits.${name} must be a positive integer.`);
    }
  }
}

function assertPathPattern(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const prefix = value.endsWith("/**") ? value.slice(0, -3) : value;
  if (
    !prefix ||
    prefix.startsWith("/") ||
    prefix === ".." ||
    prefix.startsWith("../") ||
    prefix.includes("/../") ||
    prefix.includes("\\") ||
    prefix.includes("*")
  ) {
    throw new Error(
      `${field} must be repository-relative and supports only exact paths or trailing /**.`
    );
  }
}

function assertPolicy(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object") {
    throw new Error("policy must be an object.");
  }
  const policy = value as Record<string, unknown>;
  if (
    policy.blockOn !== undefined &&
    (!Array.isArray(policy.blockOn) ||
      policy.blockOn.some(
        (kind) => typeof kind !== "string" || !REVIEW_FINDING_KINDS.has(kind as ReviewFindingKind)
      ))
  ) {
    throw new Error("policy.blockOn must contain supported finding kinds.");
  }
  if (
    Array.isArray(policy.blockOn) &&
    new Set(policy.blockOn).size !== policy.blockOn.length
  ) {
    throw new Error("policy.blockOn must not contain duplicate finding kinds.");
  }
  if (policy.protectedPaths !== undefined) {
    if (!Array.isArray(policy.protectedPaths)) {
      throw new Error("policy.protectedPaths must be an array.");
    }
    const protectedPatterns = new Set<string>();
    policy.protectedPaths.forEach((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`policy.protectedPaths[${index}] must be an object.`);
      }
      const entry = value as Record<string, unknown>;
      assertPathPattern(entry.pattern, `policy.protectedPaths[${index}].pattern`);
      if (protectedPatterns.has(entry.pattern)) {
        throw new Error(
          `policy.protectedPaths pattern '${entry.pattern}' is duplicated.`
        );
      }
      protectedPatterns.add(entry.pattern);
      if (
        entry.requireManualApproval !== undefined &&
        typeof entry.requireManualApproval !== "boolean"
      ) {
        throw new Error(
          `policy.protectedPaths[${index}].requireManualApproval must be boolean.`
        );
      }
    });
  }

  if (policy.suppressions === undefined) return;
  if (!Array.isArray(policy.suppressions)) {
    throw new Error("policy.suppressions must be an array.");
  }
  const ids = new Set<string>();
  const targets = new Set<string>();
  policy.suppressions.forEach((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`policy.suppressions[${index}] must be an object.`);
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.id)) {
      throw new Error(
        `policy.suppressions[${index}].id must be a stable identifier up to 64 characters.`
      );
    }
    if (ids.has(entry.id)) {
      throw new Error(`policy.suppressions id '${entry.id}' is duplicated.`);
    }
    ids.add(entry.id);
    assertBoundedText(entry.findingId, `policy.suppressions[${index}].findingId`, 128);
    if (!SUPPRESSIBLE_FINDING_KINDS.has(entry.kind as SuppressibleFindingKind)) {
      throw new Error(
        `policy.suppressions[${index}].kind must name a suppressible warning finding.`
      );
    }
    assertBoundedText(entry.owner, `policy.suppressions[${index}].owner`, 128);
    assertBoundedText(entry.reason, `policy.suppressions[${index}].reason`, 512);
    if (typeof entry.expiresAt !== "string" || !isValidDate(entry.expiresAt)) {
      throw new Error(
        `policy.suppressions[${index}].expiresAt must be a valid YYYY-MM-DD date.`
      );
    }
    const target = `${entry.findingId}\0${entry.kind}`;
    if (targets.has(target)) {
      throw new Error(
        `policy.suppressions target '${entry.findingId}' and '${entry.kind}' is duplicated.`
      );
    }
    targets.add(target);
  });
}

function assertBoundedText(value: unknown, field: string, maxLength: number): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function loadConfig(
  repositoryRoot: string,
  configPath = ".agentship.yml"
): Promise<{ config: AgentShipConfig; absolutePath: string; source: string }> {
  const absolutePath = path.resolve(repositoryRoot, configPath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = parse(source) as Record<string, unknown> | null;

  if (!parsed || parsed.version !== 1) {
    throw new Error("AgentShip configuration must declare version: 1.");
  }
  if (parsed.mode !== "report" && parsed.mode !== "gate") {
    throw new Error("AgentShip configuration mode must be 'report' or 'gate'.");
  }
  if (!Array.isArray(parsed.checks) || parsed.checks.length === 0) {
    throw new Error("AgentShip configuration must contain at least one check.");
  }
  parsed.checks.forEach(assertCheck);
  assertLimits(parsed.limits);
  assertPolicy(parsed.policy);

  return {
    config: parsed as unknown as AgentShipConfig,
    absolutePath,
    source,
  };
}
