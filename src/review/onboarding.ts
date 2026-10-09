import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { resolveRepositoryRoot } from "./git";

const MAX_PACKAGE_BYTES = 1024 * 1024;

export interface DoctorResult {
  schemaVersion: 1;
  repository: string;
  config: { path: string; sha256: string; mode: "report" | "gate" };
  ready: boolean;
  issues: string[];
  warnings: string[];
  checks: Array<{ name: string; backend: "direct" | "bubblewrap"; ready: boolean }>;
}

export async function initializeRepository(cwd: string): Promise<{
  repository: string;
  configPath: string;
  checks: string[];
}> {
  const repository = await resolveRepositoryRoot(cwd);
  const configPath = path.join(repository, ".agentship.yml");
  const packagePath = path.join(repository, "package.json");
  let packageSource: Buffer;
  try {
    packageSource = await readFile(packagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("AgentShip init currently requires package.json scripts.");
    }
    throw error;
  }
  if (packageSource.length === 0 || packageSource.length > MAX_PACKAGE_BYTES) {
    throw new Error(`package.json must contain 1-${MAX_PACKAGE_BYTES} bytes.`);
  }
  const parsed = JSON.parse(packageSource.toString("utf8")) as { scripts?: unknown };
  const scripts = parsed.scripts && typeof parsed.scripts === "object"
    ? parsed.scripts as Record<string, unknown>
    : {};
  const selected = ["lint", "test", "build"].filter(
    (name) => typeof scripts[name] === "string" && scripts[name].trim()
  );
  if (selected.length === 0) {
    throw new Error("package.json must define at least one of lint, test, or build before AgentShip init.");
  }
  const checkLines = selected.flatMap((name) => [
    `  - name: ${name}`,
    `    run: npm run ${name}`,
    "    required: true",
    `    timeoutSeconds: ${name === "build" ? 180 : 120}`,
    "    network: denied",
    "",
  ]);
  const source = [
    "version: 1",
    "mode: report",
    "",
    "limits:",
    "  maxChangedFiles: 500",
    "  maxDiffBytes: 5242880",
    "  maxCheckSeconds: 480",
    "",
    "checks:",
    ...checkLines,
  ].join("\n").trimEnd() + "\n";
  try {
    await writeFile(configPath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(".agentship.yml already exists; init never overwrites it.");
    }
    throw error;
  }
  return { repository, configPath, checks: selected };
}

export async function diagnoseRepository(cwd: string): Promise<DoctorResult> {
  const repository = await resolveRepositoryRoot(cwd);
  const loaded = await loadConfig(repository);
  const issues: string[] = [];
  const warnings: string[] = [];
  const checks = loaded.config.checks.map((check) => {
    let ready = true;
    if (check.isolation === "bubblewrap") {
      if (process.platform !== "linux") {
        issues.push(`Check '${check.name}' requires Linux bubblewrap isolation.`);
        ready = false;
      }
      for (const executable of [
        "/usr/bin/bwrap",
        "/usr/bin/unshare",
        "/usr/bin/setpriv",
        "/usr/bin/git",
      ]) {
        if (!existsSync(executable)) {
          issues.push(`Check '${check.name}' requires ${executable}.`);
          ready = false;
        }
      }
    } else {
      warnings.push(`Check '${check.name}' executes directly with host filesystem access.`);
      if (check.network === "denied") {
        warnings.push(`Check '${check.name}' declares denied network, but direct execution cannot enforce it.`);
      }
    }
    if (check.resources && (process.platform !== "linux" || !existsSync("/usr/bin/prlimit"))) {
      issues.push(`Check '${check.name}' resource limits require Linux /usr/bin/prlimit.`);
      ready = false;
    }
    const backend: "direct" | "bubblewrap" = check.isolation ?? "direct";
    return { name: check.name, backend, ready };
  });
  try {
    await access(repository, constants.R_OK | constants.X_OK);
  } catch {
    issues.push("Repository root is not readable and searchable by the current user.");
  }
  return {
    schemaVersion: 1,
    repository,
    config: {
      path: path.relative(repository, loaded.absolutePath),
      sha256: createHash("sha256").update(loaded.source).digest("hex"),
      mode: loaded.config.mode,
    },
    ready: issues.length === 0,
    issues,
    warnings: [...new Set(warnings)],
    checks,
  };
}
