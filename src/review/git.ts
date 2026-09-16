import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trimEnd();
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
