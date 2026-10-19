import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GitProvenance } from "./types";
import { collectUntrackedManifest } from "./untracked-evidence";

const execFileAsync = promisify(execFile);
const MAX_GIT_BYTES = 128 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(resolveTrustedGitExecutable(cwd), ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

async function gitPaths(args: string[], cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(resolveTrustedGitExecutable(cwd), ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  let names: string;
  try {
    // A filename's BOM is part of its identity, not a stream encoding marker.
    names = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch {
    throw new Error("Git path list contains invalid UTF-8; refusing ambiguous filename evidence.");
  }
  if (names === "") return [];
  if (!names.endsWith("\0")) throw new Error("Git path list is not NUL-terminated.");
  const paths = names.slice(0, -1).split("\0");
  if (paths.some(name => name === "")) throw new Error("Git path list contains an empty filename.");
  return paths;
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

export async function prepareBaseWorktree(
  repositoryRoot: string,
  commit: string
): Promise<{ commit: string; directory: string; cleanup(): Promise<void> }> {
  if (!isCommit(commit)) {
    throw new Error("Base worktree requires an already resolved commit identifier.");
  }
  const parent = await mkdtemp(path.join(os.tmpdir(), "agentship-base-"));
  const directory = path.join(parent, "worktree");
  const hooks = path.join(parent, "disabled-hooks");
  const noHooks = ["-c", `core.hooksPath=${hooks}`, "-c", "submodule.recurse=false", "-c", "core.sparseCheckout=false", "-c", "index.sparse=false"];
  let registered = false;
  const cleanup = async () => {
    try {
      if (registered) await git([...noHooks, "worktree", "remove", "--force", directory], repositoryRoot);
    } finally { await rm(parent, { recursive: true, force: true }); }
  };
  try {
    await mkdir(hooks, { mode: 0o700 });
    // Never materialize blobs until attributes from the target commit's private
    // index have been checked; the source checkout may have different attributes.
    await git([...noHooks, "worktree", "add", "--detach", "--no-checkout", directory, commit], repositoryRoot);
    registered = true;
    await git([...noHooks, "read-tree", commit], directory);
    await assertNoHostGitFilters(directory, true);
    await git([...noHooks, "checkout-index", "--all", "--force"], directory);
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Temporary worktree preparation and cleanup failed."); }
    throw error;
  }
  return { commit, directory, cleanup };
}

export async function collectGitEvidence(
  repositoryRoot: string,
  options: { staged: boolean; base?: string; comparisonBaseCommit?: string }
): Promise<{
  scope: "working-tree" | "staged" | "base";
  diff: string;
  changedFiles: string[];
  headCommit?: string;
  baseCommit?: string;
  baseReferenceCommit?: string;
}> {
  if (options.staged && options.base) {
    throw new Error("Use either --staged or --base, not both.");
  }
  if (options.comparisonBaseCommit !== undefined && (!options.base || !isCommit(options.comparisonBaseCommit))) {
    throw new Error("A pinned comparison base must be a full commit identifier with --base.");
  }
  await assertNoHostGitFilters(repositoryRoot);

  if (options.staged) {
    const [diff, names] = await Promise.all([
      git(["diff", "--cached", "--binary", "--no-ext-diff"], repositoryRoot),
      gitPaths(["diff", "--cached", "--name-only", "-z", "--no-ext-diff"], repositoryRoot),
    ]);
    return { scope: "staged", diff, changedFiles: names };
  }

  if (options.base) {
    const [headCommit, baseReferenceCommit] = await Promise.all([
      resolveCommit(repositoryRoot, "HEAD"), resolveCommit(repositoryRoot, options.base),
    ]);
    const baseCommit = options.comparisonBaseCommit ?? await uniqueMergeBase(repositoryRoot, baseReferenceCommit, headCommit);
    const [diff, names] = await Promise.all([
      git(["diff", "--binary", "--no-ext-diff", baseCommit, headCommit, "--"], repositoryRoot),
      gitPaths(["diff", "--name-only", "-z", "--no-ext-diff", baseCommit, headCommit, "--"], repositoryRoot),
    ]);
    return { scope: "base", diff, changedFiles: names, headCommit, baseCommit, baseReferenceCommit };
  }

  const [diff, trackedNames, untrackedNames] = await Promise.all([
    git(["diff", "HEAD", "--binary", "--no-ext-diff"], repositoryRoot),
    gitPaths(["diff", "HEAD", "--name-only", "-z", "--no-ext-diff"], repositoryRoot),
    gitPaths(["ls-files", "--others", "--exclude-standard", "-z"], repositoryRoot),
  ]);
  const untrackedFiles = untrackedNames;
  const changedFiles = [...new Set([...trackedNames, ...untrackedFiles])].sort();
  const untrackedManifest = await collectUntrackedManifest(repositoryRoot, untrackedFiles);
  return {
    scope: "working-tree",
    diff: [diff, untrackedManifest].filter(Boolean).join("\n"),
    changedFiles,
  };
}

const isCommit = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

async function resolveCommit(root: string, reference: string): Promise<string> {
  const commit = await git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], root);
  if (!isCommit(commit)) throw new Error("Git returned an invalid resolved commit identifier.");
  return commit;
}

async function uniqueMergeBase(root: string, base: string, head: string): Promise<string> {
  const bases = (await git(["merge-base", "--all", base, head], root)).split("\n");
  if (bases.length !== 1 || !isCommit(bases[0])) {
    throw new Error("Base comparison requires a unique merge base; choose an explicit common ancestor commit.");
  }
  return bases[0];
}

export async function inspectTrackedHeadState(root: string, head: string): Promise<{ dirtyFiles: string[]; hiddenFiles: string[] }> {
  if (!isCommit(head)) throw new Error("Tracked-state inspection requires a resolved head commit.");
  await assertNoHostGitFilters(root);
  const modeOptions = process.platform === "win32" ? [] : ["-c", "core.filemode=true"];
  const [working, staged, tagged] = await Promise.all([
    gitPaths([...modeOptions, "diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", head, "--"], root),
    gitPaths([...modeOptions, "diff", "--cached", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", head, "--"], root),
    gitPaths(["ls-files", "-v", "-z"], root),
  ]);
  const hiddenFiles: string[] = [];
  for (const entry of tagged) {
    if (entry.length < 3 || entry[1] !== " ") throw new Error("Git returned malformed index-state evidence.");
    // Lowercase tags mean assume-unchanged; S denotes skip-worktree/sparse paths.
    // Reject other non-cached tags as well rather than treating them as clean.
    if (entry[0] !== "H") hiddenFiles.push(entry.slice(2));
  }
  return { dirtyFiles: [...new Set([...working, ...staged])].sort(), hiddenFiles: [...new Set(hiddenFiles)].sort() };
}

async function assertNoHostGitFilters(root: string, cachedOnly = false): Promise<void> {
  // check-attr renders Boolean false/missing and literal values with the same
  // "unset"/"unspecified" strings. Such driver names cannot be safely classified
  // from that protocol, so refuse configured commands using reserved names.
  try {
    const reserved = await git(["config", "--name-only", "--get-regexp", "^filter\\.(unset|unspecified)\\.(clean|smudge|process)$"], root);
    if (reserved) throw new Error("Git filter attributes require isolated materialization; reserved-name filter commands were refused.");
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
  }
  const paths = await gitPaths(["ls-files", "--cached", "-z"], root);
  // Bound argv sizes, preserve literal filenames and validate one response triple
  // per requested path. Attribute checks read data; they do not run filter drivers.
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const filename of paths) {
    const size = Buffer.byteLength(filename) + 1;
    if (size > 16384) throw new Error("Git attribute path exceeds the bounded argument limit.");
    if (bytes + size > 16384) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(filename);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  for (const cached of cachedOnly ? [true] : [false, true]) {
    for (const names of batches) {
      const fields = await gitPaths(["--literal-pathspecs", "check-attr", ...(cached ? ["--cached"] : []), "-z", "filter", "--", ...names], root);
      if (fields.length !== names.length * 3) throw new Error("Git returned malformed filter attribute evidence.");
      for (const [index, filename] of names.entries()) {
        if (fields[index * 3] !== filename || fields[index * 3 + 1] !== "filter") throw new Error("Git returned mismatched filter attribute evidence.");
        if (!["unspecified", "unset"].includes(fields[index * 3 + 2])) {
          throw new Error("Git filter attributes require isolated materialization; host-side conversion was refused.");
        }
      }
    }
  }
}
