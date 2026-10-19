import path from "node:path";
import { parse } from "yaml";
import { decodeUtf8Input, readBoundedRegularFile } from "./bounded-file";
import type {
  AgentShipConfig,
  ReviewCheckConfig,
  ReviewFindingKind,
  SuppressibleFindingKind,
} from "./types";

export const REVIEW_FINDING_KINDS = new Set<ReviewFindingKind>([
  "required_check_failed",
  "required_check_timed_out",
  "check_resource_limit_exceeded",
  "check_resource_accounting_failed",
  "causal_check_not_reproduced",
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

export const MAX_CONFIG_BYTES = 256 * 1024;
export const MAX_CONFIG_CHECKS = 128;
const MAX_CHECK_NAME_LENGTH = 128;
const MAX_CHECK_COMMAND_BYTES = 16 * 1024;
const MAX_LIST_ENTRIES = 256;
const MAX_PATH_PATTERN_LENGTH = 512;
const MAX_SUPPRESSIONS = 1_024;

function assertCheck(value: unknown, index: number): asserts value is ReviewCheckConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`checks[${index}] must be an object.`);
  }

  const check = value as Record<string, unknown>;
  assertBoundedText(check.name, `checks[${index}].name`, MAX_CHECK_NAME_LENGTH);
  if (check.name !== check.name.trim()) {
    throw new Error(`checks[${index}].name must not have surrounding whitespace.`);
  }
  if (/\p{Cc}|\p{Cf}/u.test(check.name)) {
    throw new Error(`checks[${index}].name must not contain control characters.`);
  }
  if (
    typeof check.run !== "string" ||
    !check.run.trim() ||
    Buffer.byteLength(check.run) > MAX_CHECK_COMMAND_BYTES ||
    check.run.includes("\0")
  ) {
    throw new Error(
      `checks[${index}].run must be non-empty and at most ${MAX_CHECK_COMMAND_BYTES} bytes.`
    );
  }
  if (check.required !== undefined && typeof check.required !== "boolean") {
    throw new Error(`checks[${index}].required must be boolean.`);
  }
  if (
    check.timeoutSeconds !== undefined &&
    (typeof check.timeoutSeconds !== "number" ||
      !Number.isFinite(check.timeoutSeconds) ||
      check.timeoutSeconds <= 0 ||
      check.timeoutSeconds > 86_400)
  ) {
    throw new Error(
      `checks[${index}].timeoutSeconds must be greater than zero and no greater than 86400.`
    );
  }
  if (
    check.network !== undefined &&
    check.network !== "allowed" &&
    check.network !== "denied"
  ) {
    throw new Error(`checks[${index}].network must be 'allowed' or 'denied'.`);
  }
  if (
    check.environment !== undefined &&
    (!Array.isArray(check.environment) ||
      check.environment.length > MAX_LIST_ENTRIES ||
      check.environment.some(
        (name) =>
          typeof name !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      ))
  ) {
    throw new Error(
      `checks[${index}].environment must contain at most ${MAX_LIST_ENTRIES} valid variable names.`
    );
  }
  if (
    Array.isArray(check.environment) &&
    new Set(check.environment).size !== check.environment.length
  ) {
    throw new Error(`checks[${index}].environment must not contain duplicates.`);
  }
  if (check.whenChanged !== undefined) {
    if (
      !Array.isArray(check.whenChanged) ||
      check.whenChanged.length === 0 ||
      check.whenChanged.length > MAX_LIST_ENTRIES
    ) {
      throw new Error(
        `checks[${index}].whenChanged must contain path patterns (1 to ${MAX_LIST_ENTRIES}).`
      );
    }
    check.whenChanged.forEach((pattern, patternIndex) =>
      assertPathPattern(pattern, `checks[${index}].whenChanged[${patternIndex}]`)
    );
    if (new Set(check.whenChanged).size !== check.whenChanged.length) {
      throw new Error(`checks[${index}].whenChanged must not contain duplicates.`);
    }
  }
  if (check.isolation !== undefined && check.isolation !== "bubblewrap") {
    throw new Error(`checks[${index}].isolation must be 'bubblewrap'.`);
  }
  if (check.causal !== undefined) {
    if (!check.causal || typeof check.causal !== "object" || Array.isArray(check.causal)) {
      throw new Error(`checks[${index}].causal must be an object.`);
    }
    const causal = check.causal as Record<string, unknown>;
    if (causal.expectation !== "fails_on_base") {
      throw new Error(`checks[${index}].causal.expectation must be 'fails_on_base'.`);
    }
    if (
      !Array.isArray(causal.testPaths) ||
      causal.testPaths.length === 0 ||
      causal.testPaths.length > MAX_LIST_ENTRIES
    ) {
      throw new Error(
        `checks[${index}].causal.testPaths must contain path patterns (1 to ${MAX_LIST_ENTRIES}).`
      );
    }
    causal.testPaths.forEach((pattern, patternIndex) =>
      assertPathPattern(pattern, `checks[${index}].causal.testPaths[${patternIndex}]`)
    );
    if (new Set(causal.testPaths).size !== causal.testPaths.length) {
      throw new Error(`checks[${index}].causal.testPaths must not contain duplicates.`);
    }
  }
  if (check.causal && check.isolation !== "bubblewrap") {
    throw new Error(`checks[${index}].causal requires isolation: bubblewrap.`);
  }
  if (check.causal && check.required === false) {
    throw new Error(`checks[${index}].causal checks must be required.`);
  }
  assertCheckResources(check.resources, index);
  const resources = check.resources as ReviewCheckConfig["resources"];
  if (resources?.maxWorkspaceMiB !== undefined && check.isolation !== "bubblewrap") {
    throw new Error(
      `checks[${index}].resources.maxWorkspaceMiB requires isolation: bubblewrap.`
    );
  }
}

function assertCheckResources(value: unknown, checkIndex: number): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`checks[${checkIndex}].resources must be an object.`);
  }
  const resources = value as Record<string, unknown>;
  const bounds = {
    cpuSeconds: 86_400,
    memoryMiB: 1_048_576,
    maxFileSizeMiB: 1_048_576,
    maxOpenFiles: 1_048_576,
    maxWorkspaceMiB: 1_048_576,
  } as const;
  const supported = new Set(Object.keys(bounds));
  for (const name of Object.keys(resources)) {
    if (!supported.has(name)) {
      throw new Error(`checks[${checkIndex}].resources.${name} is unsupported.`);
    }
  }
  let configured = 0;
  for (const [name, maximum] of Object.entries(bounds)) {
    const limit = resources[name];
    if (limit === undefined) continue;
    configured++;
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > maximum
    ) {
      throw new Error(
        `checks[${checkIndex}].resources.${name} must be a positive integer no greater than ${maximum}.`
      );
    }
  }
  if (configured === 0) {
    throw new Error(`checks[${checkIndex}].resources must configure at least one limit.`);
  }
}

function assertLimits(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("limits must be an object.");
  }
  const limits = value as Record<string, unknown>;
  const supported = new Set([
    "maxChangedFiles",
    "maxDiffBytes",
    "maxCheckSeconds",
  ]);
  for (const name of Object.keys(limits)) {
    if (!supported.has(name)) throw new Error(`limits.${name} is unsupported.`);
  }
  for (const name of ["maxChangedFiles", "maxDiffBytes"] as const) {
    const limit = limits[name];
    if (
      limit !== undefined &&
      (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)
    ) {
      throw new Error(`limits.${name} must be a positive integer.`);
    }
  }
  const maxCheckSeconds = limits.maxCheckSeconds;
  if (
    maxCheckSeconds !== undefined &&
    (typeof maxCheckSeconds !== "number" ||
      !Number.isFinite(maxCheckSeconds) ||
      maxCheckSeconds <= 0 ||
      maxCheckSeconds > 86_400)
  ) {
    throw new Error(
      "limits.maxCheckSeconds must be greater than zero and no greater than 86400."
    );
  }
}

function assertPathPattern(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > MAX_PATH_PATTERN_LENGTH ||
    /\p{Cc}|\p{Cf}/u.test(value)
  ) {
    throw new Error(
      `${field} must be a non-empty string of at most ${MAX_PATH_PATTERN_LENGTH} characters without control characters.`
    );
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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
    if (
      !Array.isArray(policy.protectedPaths) ||
      policy.protectedPaths.length > MAX_LIST_ENTRIES
    ) {
      throw new Error(
        `policy.protectedPaths must be an array of at most ${MAX_LIST_ENTRIES} entries.`
      );
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
  if (policy.suppressions.length > MAX_SUPPRESSIONS) {
    throw new Error(`policy.suppressions must contain at most ${MAX_SUPPRESSIONS} entries.`);
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

function assertBoundedText(
  value: unknown,
  field: string,
  maxLength: number
): asserts value is string {
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
  const source = decodeUtf8Input(
    await readBoundedRegularFile(
      absolutePath,
      "AgentShip configuration",
      MAX_CONFIG_BYTES
    ),
    "AgentShip configuration"
  );
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
  if (parsed.checks.length > MAX_CONFIG_CHECKS) {
    throw new Error(
      `AgentShip configuration must contain at most ${MAX_CONFIG_CHECKS} checks.`
    );
  }
  parsed.checks.forEach(assertCheck);
  const checkNames = parsed.checks.map((check) => (check as ReviewCheckConfig).name);
  if (new Set(checkNames).size !== checkNames.length) {
    throw new Error("AgentShip configuration check names must be unique.");
  }
  assertLimits(parsed.limits);
  assertPolicy(parsed.policy);

  return {
    config: parsed as unknown as AgentShipConfig,
    absolutePath,
    source,
  };
}
