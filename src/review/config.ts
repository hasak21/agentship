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

  return {
    config: parsed as unknown as AgentShipConfig,
    absolutePath,
    source,
  };
}
