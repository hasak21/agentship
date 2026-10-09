import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CheckEvidence, ReviewCheckConfig } from "./types";

export const BUBBLEWRAP_PATH = "/usr/bin/bwrap";
export const UNSHARE_PATH = "/usr/bin/unshare";
export const SETPRIV_PATH = "/usr/bin/setpriv";
const GIT_PATH = "/usr/bin/git";
const MAX_WORKSPACE_ENTRIES = 200_000;
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024 * 1024;
const OMITTED_ROOT_ENTRIES = new Set([".agentship", ".git", "node_modules"]);
const execFileAsync = promisify(execFile);

export interface PreparedSandbox {
  file: string;
  args: string[];
  execution: NonNullable<CheckEvidence["execution"]>;
  cleanup(): Promise<void>;
}

export async function prepareBubblewrapSandbox(
  check: ReviewCheckConfig,
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform,
  bubblewrapAvailable = existsSync(BUBBLEWRAP_PATH),
  dependenciesRoot = repositoryRoot
): Promise<PreparedSandbox> {
  if (
    platform !== "linux" ||
    !bubblewrapAvailable ||
    !existsSync(UNSHARE_PATH) ||
    !existsSync(SETPRIV_PATH) ||
    !existsSync(GIT_PATH)
  ) {
    throw new Error(
      "Configured bubblewrap isolation requires Linux with /usr/bin/bwrap, /usr/bin/unshare, /usr/bin/setpriv, and /usr/bin/git; the check was not executed."
    );
  }

  const absoluteRoot = path.resolve(repositoryRoot);
  if (absoluteRoot === path.parse(absoluteRoot).root) {
    throw new Error("Bubblewrap isolation refuses to copy a filesystem root.");
  }
  const sandboxDirectory = await mkdtemp(
    path.join(os.tmpdir(), "agentship-sandbox-")
  );
  const workspace = path.join(sandboxDirectory, "workspace");
  try {
    await copyWorkspace(absoluteRoot, workspace);
    const nodeModules = path.join(path.resolve(dependenciesRoot), "node_modules");
    const nodeModulesAvailable = await isDirectory(nodeModules);
    if (nodeModulesAvailable) {
      await mkdir(path.join(workspace, "node_modules"), { recursive: true });
    }
    const args = buildBubblewrapArguments({
      repositoryRoot: absoluteRoot,
      workspace,
      nodeModules: nodeModulesAvailable ? await realpath(nodeModules) : undefined,
      network: check.network === "allowed" ? "allowed" : "denied",
      command: check.run,
    });
    return {
      file: check.network === "allowed" ? BUBBLEWRAP_PATH : UNSHARE_PATH,
      args,
      execution: {
        backend: "linux-bubblewrap",
        ...(check.resources ? { resourceLimits: check.resources } : {}),
        isolation: {
          workspace: "disposable-copy",
          hostFilesystem: "minimal-read-only-runtime",
          network: check.network === "allowed" ? "allowed" : "denied",
        },
      },
      cleanup: () => rm(sandboxDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(sandboxDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function buildBubblewrapArguments(options: {
  repositoryRoot: string;
  workspace: string;
  nodeModules?: string;
  network: "allowed" | "denied";
  command: string;
}): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
  ];

  const runtimePaths = minimalRuntimePaths();
  for (const runtimePath of runtimePaths) {
    args.push("--ro-bind", runtimePath, runtimePath);
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  for (const directory of parentDirectories(options.repositoryRoot)) {
    args.push("--dir", directory);
  }
  const command = options.network === "denied"
    ? [
        SETPRIV_PATH,
        "--bounding-set=-all",
        "--inh-caps=-all",
        "--ambient-caps=-all",
        "--",
        "/bin/sh",
        "-c",
        options.command,
      ]
    : ["/bin/sh", "-c", options.command];
  args.push(
    "--dir",
    "/tmp/agentship-home",
    "--dir",
    options.repositoryRoot,
    "--bind",
    options.workspace,
    options.repositoryRoot
  );
  if (options.nodeModules) {
    args.push(
      "--ro-bind",
      options.nodeModules,
      path.join(options.repositoryRoot, "node_modules")
    );
  }
  if (options.network === "allowed") {
    args.push(
      "--dir",
      "/etc",
      "--ro-bind-try",
      "/etc/ssl",
      "/etc/ssl",
      "--ro-bind-try",
      "/etc/resolv.conf",
      "/etc/resolv.conf",
      "--ro-bind-try",
      "/etc/hosts",
      "/etc/hosts",
      "--ro-bind-try",
      "/etc/nsswitch.conf",
      "/etc/nsswitch.conf"
    );
  }
  args.push(
    "--chdir",
    options.repositoryRoot,
    "--setenv",
    "HOME",
    "/tmp/agentship-home",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "AGENTSHIP_SANDBOX",
    "bubblewrap",
    "--",
    ...command
  );
  return options.network === "denied"
    ? ["--user", "--map-root-user", "--net", BUBBLEWRAP_PATH, ...args]
    : args;
}

async function copyWorkspace(sourceRoot: string, destinationRoot: string): Promise<void> {
  const { stdout } = await execFileAsync(
    GIT_PATH,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: sourceRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const files = stdout
    .split("\0")
    .filter(Boolean)
    .filter((name) => !OMITTED_ROOT_ENTRIES.has(name.split("/", 1)[0] ?? ""))
    .sort();
  if (files.length > MAX_WORKSPACE_ENTRIES) {
    throw new Error(
      `Bubblewrap workspace exceeds ${MAX_WORKSPACE_ENTRIES} filesystem entries.`
    );
  }
  await mkdir(destinationRoot, { recursive: true });
  let bytes = 0;
  for (const relativeName of files) {
    if (
      path.posix.isAbsolute(relativeName) ||
      relativeName.split("/").some((part) => !part || part === "..")
    ) {
      throw new Error(`Git returned an unsafe workspace path '${relativeName}'.`);
    }
    const source = path.join(sourceRoot, ...relativeName.split("/"));
    const destination = path.join(destinationRoot, ...relativeName.split("/"));
    let stats;
    try {
      stats = await lstat(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    if (stats.isSymbolicLink()) {
      await symlink(await readlink(source), destination);
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(
        `Bubblewrap workspace contains unsupported tracked entry '${relativeName}'.`
      );
    }
    bytes += stats.size;
    if (bytes > MAX_WORKSPACE_BYTES) {
      throw new Error(
        `Bubblewrap workspace exceeds ${MAX_WORKSPACE_BYTES} copied bytes.`
      );
    }
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
    await chmod(destination, stats.mode & 0o777);
  }
}

function minimalRuntimePaths(): string[] {
  const candidates = ["/usr", "/bin", "/lib", "/lib64"];
  const nodePrefix = path.dirname(path.dirname(process.execPath));
  if (!candidates.some((candidate) => isContained(nodePrefix, candidate))) {
    candidates.push(nodePrefix);
  }
  return [...new Set(candidates.filter(existsSync))];
}

function parentDirectories(absolutePath: string): string[] {
  const root = path.parse(absolutePath).root;
  const relativeParts = absolutePath.slice(root.length).split(path.sep).filter(Boolean);
  const directories: string[] = [];
  let current = root;
  for (const part of relativeParts.slice(0, -1)) {
    current = path.join(current, part);
    directories.push(current);
  }
  return directories;
}

function isContained(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
