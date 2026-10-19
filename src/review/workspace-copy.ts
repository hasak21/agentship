import { execFile } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readlink, symlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { descriptorChildPath, openRepositoryParent } from "./repository-directory";

const exec = promisify(execFile);
const MAX_ENTRIES = 200_000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const OMITTED = new Set([".agentship", ".git", "node_modules"]);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Copies to a newly created private workspace, never traversing repository links. */
export async function copySandboxWorkspace(
  sourceRoot: string,
  destinationRoot: string,
  limits: { maxEntries?: number; maxBytes?: number } = {}
): Promise<void> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) {
    throw new Error("Workspace copy overrides may only tighten positive built-in limits.");
  }
  if (process.platform !== "linux" || [sourceRoot, destinationRoot].some(root => path.resolve(root) === path.parse(path.resolve(root)).root)) {
    throw new Error("Workspace copying requires Linux and refuses filesystem roots.");
  }
  const { stdout } = await exec("/usr/bin/git", ["-c", "core.fsmonitor=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: sourceRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const files = stdout.split("\0").filter(Boolean).filter(name => !OMITTED.has(name.split("/", 1)[0])).sort();
  if (files.length > maxEntries || new Set(files).size !== files.length) {
    throw new Error(`Bubblewrap workspace exceeds ${maxEntries} unique filesystem entries.`);
  }
  const entries = files.map(name => {
    const parts = name.split("/");
    if (parts.length > 128 || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || name.includes("\ufffd")) {
      throw new Error("Git returned an unsafe or ambiguous workspace path.");
    }
    return { name, parts };
  });
  const projectedEntries = new Set<string>();
  for (const { parts } of entries) {
    let prefix = "";
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      projectedEntries.add(prefix);
      if (projectedEntries.size > maxEntries) {
        throw new Error(`Bubblewrap workspace exceeds ${maxEntries} projected filesystem entries including directories.`);
      }
    }
  }
  // Refuse existing destinations, including links, instead of trusting their contents.
  await mkdir(destinationRoot, { mode: 0o755 });
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  for (const { name, parts } of entries) {
    const handles: FileHandle[] = [];
    try {
      const parent = await openRepositoryParent(sourceRoot, parts, false, handles);
      if (!parent) continue; // Tracked paths deleted from the working tree.
      const sourcePath = descriptorChildPath(parent, parts.at(-1)!);
      let entry: Stats;
      try { entry = await lstat(sourcePath); }
      catch (error) { if (missing(error)) continue; throw error; }
      const targetParent = await openRepositoryParent(destinationRoot, parts, true, handles);
      if (!targetParent) throw new Error("Workspace destination parent was not created.");
      const targetPath = descriptorChildPath(targetParent, parts.at(-1)!);
      if (entry.isSymbolicLink()) {
        const target = await readlink(sourcePath, { encoding: "buffer" });
        bytes += target.length;
        if (target.length > 64 * 1024 || bytes > maxBytes || !sameEntry(entry, await lstat(sourcePath))) {
          throw new Error("Workspace link changed or exceeds copied-byte limits.");
        }
        await symlink(target, targetPath);
        continue;
      }
      if (!entry.isFile() || entry.nlink !== 1) {
        throw new Error(`Bubblewrap workspace entry '${name}' must be a single-link regular file or symbolic link.`);
      }
      if (bytes + entry.size > maxBytes) throw new Error(`Bubblewrap workspace exceeds ${maxBytes} copied bytes.`);
      const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      handles.push(source);
      const before = await source.stat();
      if (!before.isFile() || !sameEntry(entry, before)) throw new Error("Workspace source changed before copying.");
      const target = await open(targetPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      handles.push(target);
      let copied = 0;
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        copied += bytesRead;
        bytes += bytesRead;
        if (bytes > maxBytes) throw new Error(`Bubblewrap workspace exceeds ${maxBytes} copied bytes.`);
        let written = 0;
        while (written < bytesRead) {
          const { bytesWritten } = await target.write(buffer, written, bytesRead - written, null);
          if (!bytesWritten) throw new Error("Workspace copy made no write progress.");
          written += bytesWritten;
        }
      }
      if (copied !== before.size || !sameEntry(before, await source.stat()) || !sameEntry(before, await lstat(sourcePath))) {
        throw new Error("Workspace source changed during copying.");
      }
      await target.chmod(before.mode & 0o777);
    } finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
  }
}

function sameEntry(before: Stats, after: Stats) {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.nlink === after.nlink && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
