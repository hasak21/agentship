import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pathMatches } from "./requirement-mapper";
import { descriptorChildPath as relativeTo, openRepositoryParent as pinnedParent } from "./repository-directory";

const MAX_FILES = 256;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Linux-only, like the bubblewrap causal-check backend. Never follow repo symlinks. */
export async function overlayCausalTestFiles(
  repositoryRoot: string,
  baseWorktree: string,
  changedFiles: string[],
  patterns: string[]
): Promise<string[]> {
  if (process.platform !== "linux") throw new Error("Causal overlays require Linux directory descriptors.");
  for (const root of [repositoryRoot, baseWorktree]) {
    if (path.resolve(root) === path.parse(path.resolve(root)).root) {
      throw new Error("Causal overlays refuse filesystem roots.");
    }
  }
  if (path.resolve(repositoryRoot) === path.resolve(baseWorktree)) {
    throw new Error("Causal overlay source and destination must be distinct.");
  }
  const files = changedFiles.filter(file => patterns.some(pattern => pathMatches(pattern, file)));
  if (!files.length) throw new Error("Causal check testPaths did not match a changed file.");
  if (files.length > MAX_FILES || new Set(files).size !== files.length) {
    throw new Error(`Causal overlay requires at most ${MAX_FILES} unique files.`);
  }
  const entries = files.map(file => {
    const parts = file.split("/");
    if (parts.length > 128 || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || /[\\\u0000-\u001f\u007f]/u.test(file)) {
      throw new Error("Causal overlay requires normalized repository-relative paths.");
    }
    return { file, parts };
  });
  let totalBytes = 0;
  for (const { file, parts } of entries) {
    const handles: FileHandle[] = [];
    let temporary: string | undefined;
    try {
      const sourceParent = await pinnedParent(repositoryRoot, parts, false, handles);
      let source: FileHandle | undefined;
      if (sourceParent) {
        try {
          source = await open(relativeTo(sourceParent, parts.at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          handles.push(source);
        } catch (error) { if (!missing(error)) throw error; }
      }
      const before = await source?.stat();
      if (before && (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES)) {
        throw new Error(`Causal overlay '${file}' requires a single-link regular file of at most ${MAX_FILE_BYTES} bytes.`);
      }
      if (before && totalBytes + before.size > MAX_TOTAL_BYTES) {
        throw new Error("Causal overlay exceeds its aggregate byte limit.");
      }
      const destinationParent = await pinnedParent(baseWorktree, parts, !!source, handles);
      if (!destinationParent) continue; // Deleting an already absent path is a no-op.
      const destination = relativeTo(destinationParent, parts.at(-1)!);
      try {
        const existing = await lstat(destination);
        if (!existing.isFile()) throw new Error(`Causal overlay '${file}' destination must be a regular file, not a link or directory.`);
      } catch (error) { if (!missing(error)) throw error; }
      if (!source || !before) {
        try { await unlink(destination); } catch (error) { if (!missing(error)) throw error; }
        continue;
      }
      const temporaryPath = relativeTo(destinationParent, `.agentship-overlay-${randomUUID()}`);
      const target = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      temporary = temporaryPath;
      handles.push(target);
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let fileBytes = 0;
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        fileBytes += bytesRead;
        totalBytes += bytesRead;
        if (fileBytes > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
          throw new Error("Causal overlay exceeds its file or aggregate byte limit.");
        }
        let written = 0;
        while (written < bytesRead) {
          const { bytesWritten } = await target.write(buffer, written, bytesRead - written, null);
          if (!bytesWritten) throw new Error("Causal overlay made no write progress.");
          written += bytesWritten;
        }
      }
      const after = await source.stat();
      if (fileBytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(`Causal overlay '${file}' source changed during copying.`);
      }
      await target.chmod(before.mode & 0o777);
      // Rename replaces the directory entry, never truncating an existing target
      // inode or following a final symlink/hardlink to some other host file.
      await rename(temporary, destination);
      temporary = undefined;
    } finally {
      try {
        if (temporary) await unlink(temporary);
      } finally {
        await Promise.all(handles.reverse().map(handle => handle.close()));
      }
    }
  }
  return files;
}
