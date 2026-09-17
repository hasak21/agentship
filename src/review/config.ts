import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { AgentShipConfig, ReviewCheckConfig } from "./types";

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
      policy.blockOn.some((kind) => typeof kind !== "string" || !kind.trim()))
  ) {
    throw new Error("policy.blockOn must contain finding names.");
  }
  if (policy.protectedPaths === undefined) return;
  if (!Array.isArray(policy.protectedPaths)) {
    throw new Error("policy.protectedPaths must be an array.");
  }
  policy.protectedPaths.forEach((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`policy.protectedPaths[${index}] must be an object.`);
    }
    const entry = value as Record<string, unknown>;
    assertPathPattern(entry.pattern, `policy.protectedPaths[${index}].pattern`);
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
