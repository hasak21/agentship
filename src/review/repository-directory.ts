import { constants } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import path from "node:path";

export const descriptorChildPath = (directory: FileHandle, name: string) => `/proc/self/fd/${directory.fd}/${name}`;

/** Caller validates path components and closes every returned/pushed descriptor. */
export async function openRepositoryParent(root: string, parts: string[], create: boolean, handles: FileHandle[]) {
  if (process.platform !== "linux") throw new Error("Repository directory descriptors require Linux.");
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let current = await open(path.resolve(root), flags);
  handles.push(current);
  for (const part of parts.slice(0, -1)) {
    const next = descriptorChildPath(current, part);
    let child: FileHandle;
    try { child = await open(next, flags); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return undefined;
      try { await mkdir(next, { mode: 0o755 }); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError; }
      child = await open(next, flags);
    }
    handles.push(child);
    current = child;
  }
  return current;
}
