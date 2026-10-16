import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { descriptorChildPath, openRepositoryParent } from "./repository-directory";

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

export async function collectUntrackedManifest(root: string, files: string[]): Promise<string> {
  if (files.length > MAX_FILES || new Set(files).size !== files.length) {
    throw new Error(`Untracked evidence accepts at most ${MAX_FILES} unique paths.`);
  }
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const records: string[] = [];
  let totalBytes = 0;
  for (const name of files) {
    const parts = name.split("/");
    if (parts.length > 128 || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || name.includes("\0") || name.includes("\ufffd") || (process.platform === "win32" && name.includes("\\"))) {
      throw new Error("Untracked evidence requires unambiguous repository-relative paths.");
    }
    const handles: FileHandle[] = [];
    try {
      let source: string;
      if (process.platform === "linux") {
        const parent = await openRepositoryParent(root, parts, false, handles);
        if (!parent) throw new Error("Untracked path disappeared during evidence capture.");
        source = descriptorChildPath(parent, parts.at(-1)!);
      } else {
        // Local non-Linux fallback: reject link ancestors before opening the leaf.
        let parent = path.resolve(root);
        for (const part of parts.slice(0, -1)) {
          parent = path.join(parent, part);
          const stats = await lstat(parent);
          if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Untracked path has a link or non-directory ancestor.");
        }
        source = path.join(parent, parts.at(-1)!);
      }
      const entry = await lstat(source);
      let kind: "file" | "symlink";
      let bytes = 0;
      let sha256: string;
      if (entry.isSymbolicLink()) {
        kind = "symlink";
        const target = await readlink(source, { encoding: "buffer" });
        bytes = target.length;
        if (bytes > 64 * 1024 || !sameEntry(entry, await lstat(source))) {
          throw new Error("Untracked link changed or exceeds its target-size bound.");
        }
        sha256 = createHash("sha256").update(target).digest("hex");
      } else {
        kind = "file";
        if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_FILE_BYTES) {
          throw new Error("Untracked evidence requires single-link regular files of at most 32 MiB, or symbolic links.");
        }
        if (totalBytes + entry.size > MAX_TOTAL_BYTES) throw new Error("Untracked evidence exceeds 128 MiB total.");
        const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        handles.push(handle);
        const before = await handle.stat();
        if (!before.isFile() || !sameEntry(entry, before)) throw new Error("Untracked file changed before hashing.");
        const hash = createHash("sha256");
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          bytes += bytesRead;
          if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) throw new Error("Untracked evidence exceeds its byte limits.");
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (bytes !== before.size || !sameEntry(before, await handle.stat()) || !sameEntry(before, await lstat(source))) {
          throw new Error("Untracked file changed during hashing.");
        }
        sha256 = hash.digest("hex");
      }
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Untracked evidence exceeds 128 MiB total.");
      // One JSON-escaped record per line: filenames cannot introduce diff headers.
      records.push(`untracked:${JSON.stringify({ path: name, kind, mode: entry.mode & 0o777, bytes, sha256 })}`);
    } finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
  }
  return records.join("\n");
}

function sameEntry(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.nlink === after.nlink && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
