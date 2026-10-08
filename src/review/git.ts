import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitProvenance } from "./types";

const execFileAsync = promisify(execFile);
const MAX_GIT_BYTES = 128 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(resolveTrustedGitExecutable(cwd), args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

export function resolveTrustedGitExecutable(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): string {
  for (const candidate of knownGitCandidates(platform, environment)) {
    const trusted = trustedCandidate(candidate, cwd);
    if (trusted) return trusted;
  }

  const pathValue = environment.PATH ?? environment.Path ?? environment.path ?? "";
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry) || isRepositoryControlledBin(entry, cwd)) {
      continue;
    }
    const candidate = path.join(entry, platform === "win32" ? "git.exe" : "git");
    const trusted = trustedCandidate(candidate, cwd);
    if (trusted) return trusted;
  }
  throw new Error(
    "AgentShip could not find Git outside repository-controlled executable paths."
  );
}

function trustedCandidate(candidate: string, cwd: string): string | undefined {
  if (!existsSync(candidate)) return undefined;
  const resolved = realpathSync(candidate);
  if (!statSync(resolved).isFile()) return undefined;
  return isRepositoryControlledBin(path.dirname(resolved), cwd) ? undefined : resolved;
}

export async function getGitProvenance(cwd: string): Promise<GitProvenance> {
  const executable = resolveTrustedGitExecutable(cwd);
  const before = await hashStableGitExecutable(executable);
  const { stdout } = await execFileAsync(executable, ["--version"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024,
  });
  const version = stdout.trim();
  if (!/^git version [^\0\r\n]{1,128}$/.test(version)) {
    throw new Error("Trusted Git returned an invalid version identifier.");
  }
  const after = await hashStableGitExecutable(executable);
  if (before.bytes !== after.bytes || before.sha256 !== after.sha256) {
    throw new Error("Trusted Git changed while its provenance was being collected.");
  }
  return { executable, version, ...after };
}

async function hashStableGitExecutable(
  executable: string
): Promise<{ bytes: number; sha256: string }> {
  const handle = await open(executable, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Trusted Git must be a regular file.");
    if (before.size <= 0 || before.size > MAX_GIT_BYTES) {
      throw new Error(`Trusted Git must contain 1-${MAX_GIT_BYTES} bytes.`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, before.size));
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ino !== before.ino
    ) {
      throw new Error("Trusted Git changed while it was being hashed.");
    }
    return { bytes: position, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

function knownGitCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): string[] {
  if (platform === "win32") {
    return [
      environment.ProgramFiles && path.join(environment.ProgramFiles, "Git", "cmd", "git.exe"),
      environment["ProgramFiles(x86)"] &&
        path.join(environment["ProgramFiles(x86)"]!, "Git", "cmd", "git.exe"),
      environment.LOCALAPPDATA &&
        path.join(environment.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"),
    ].filter((candidate): candidate is string => Boolean(candidate));
  }
  if (platform === "darwin") {
    return ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
  }
  return ["/usr/bin/git", "/bin/git", "/usr/local/bin/git"];
}

function isRepositoryControlledBin(candidate: string, cwd: string): boolean {
  const normalized = path.resolve(candidate);
  const relative = path.relative(path.resolve(cwd), normalized);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return true;
  }
  return normalized
    .split(path.sep)
    .some((part, index, parts) => part === "node_modules" && parts[index + 1] === ".bin");
}

export async function resolveRepositoryRoot(cwd: string): Promise<string> {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

export async function getHead(repositoryRoot: string): Promise<string> {
  return git(["rev-parse", "HEAD"], repositoryRoot);
}

export async function collectGitEvidence(
  repositoryRoot: string,
  options: { staged: boolean; base?: string }
): Promise<{
  scope: "working-tree" | "staged" | "base";
  diff: string;
  changedFiles: string[];
}> {
  if (options.staged && options.base) {
    throw new Error("Use either --staged or --base, not both.");
  }

  if (options.staged) {
    const [diff, names] = await Promise.all([
      git(["diff", "--cached", "--binary", "--no-ext-diff"], repositoryRoot),
      git(["diff", "--cached", "--name-only", "--no-ext-diff"], repositoryRoot),
    ]);
    return { scope: "staged", diff, changedFiles: splitLines(names) };
  }

  if (options.base) {
    await git(["rev-parse", "--verify", options.base], repositoryRoot);
    const range = `${options.base}...HEAD`;
    const [diff, names] = await Promise.all([
      git(["diff", "--binary", "--no-ext-diff", range], repositoryRoot),
      git(["diff", "--name-only", "--no-ext-diff", range], repositoryRoot),
    ]);
    return { scope: "base", diff, changedFiles: splitLines(names) };
  }

  const [diff, trackedNames, untrackedNames] = await Promise.all([
    git(["diff", "HEAD", "--binary", "--no-ext-diff"], repositoryRoot),
    git(["diff", "HEAD", "--name-only", "--no-ext-diff"], repositoryRoot),
    git(["ls-files", "--others", "--exclude-standard"], repositoryRoot),
  ]);
  const untrackedFiles = splitLines(untrackedNames);
  const changedFiles = [...new Set([...splitLines(trackedNames), ...untrackedFiles])].sort();
  const untrackedManifest = (
    await Promise.all(
      untrackedFiles.map(async (name) => {
        const content = await readFile(path.join(repositoryRoot, name));
        const digest = createHash("sha256").update(content).digest("hex");
        return `untracked:${name}:${digest}`;
      })
    )
  ).join("\n");
  return {
    scope: "working-tree",
    diff: [diff, untrackedManifest].filter(Boolean).join("\n"),
    changedFiles,
  };
}

function splitLines(value: string): string[] {
  return value ? value.split("\n").filter(Boolean) : [];
}
