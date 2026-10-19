import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { descriptorChildPath, openRepositoryParent } from "./repository-directory";

function outputParts(root: string, output: string): string[] {
  const relative = path.relative(path.resolve(root), path.resolve(root, output));
  const parts = relative.split(path.sep);
  if (!relative || path.isAbsolute(relative) || parts.some(part => !part || part === ".." || part.toLowerCase() === ".git")) {
    throw new Error("Evidence output must be a repository child outside .git administration paths.");
  }
  return parts;
}

async function pinnedParent(root: string, parts: string[], handles: FileHandle[]): Promise<string> {
  if (process.platform === "linux") {
    const parent = await openRepositoryParent(root, parts, true, handles);
    if (!parent) throw new Error("Evidence output directory was not created.");
    return descriptorChildPath(parent, parts.at(-1)!);
  }
  let parent = path.resolve(root);
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    try { await mkdir(parent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stats = await lstat(parent);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Evidence output must not traverse a link.");
  }
  return path.join(parent, parts.at(-1)!);
}

export async function ensureArtifactDirectory(root: string, directory: string): Promise<void> {
  const handles: FileHandle[] = [];
  try { await pinnedParent(root, [...outputParts(root, directory), ".directory-marker"], handles); }
  finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
}

/** Publish one complete immutable event without replacing any existing entry. */
export async function writeNewEvidenceArtifact(root: string, artifact: { path: string; source: string }): Promise<void> {
  const parts = outputParts(root, artifact.path);
  const parents: FileHandle[] = [];
  let temporary: string | undefined;
  let file: FileHandle | undefined;
  try {
    const destination = await pinnedParent(root, parts, parents);
    const candidate = path.join(path.dirname(destination), `.agentship-artifact-${randomUUID()}.tmp`);
    file = await open(candidate, "wx", 0o600);
    temporary = candidate;
    await file.writeFile(artifact.source, "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    // A same-directory hard link publishes complete bytes atomically and fails
    // with EEXIST for any existing leaf. Rename would overwrite prior events.
    await link(temporary, destination);
  } finally {
    try {
      if (file) await file.close();
    } finally {
      try { if (temporary) await unlink(temporary); }
      finally { await Promise.all(parents.reverse().map(handle => handle.close())); }
    }
  }
}

/** Per-file atomic publication; this is not a multi-file transaction. */
export async function writeEvidenceArtifacts(root: string, artifacts: Array<{ path: string; source: string }>): Promise<void> {
  const entries = artifacts.map(artifact => ({ ...artifact, parts: outputParts(root, artifact.path) }));
  if (new Set(entries.map(entry => JSON.stringify(entry.parts))).size !== entries.length) {
    throw new Error("Evidence output destinations must be unique.");
  }
  const handles: FileHandle[] = [];
  const prepared: Array<{ destination: string; source: string; temporary?: string }> = [];
  try {
    // Preflight every destination before staging or publishing any report file.
    for (const entry of entries) {
      const destination = await pinnedParent(root, entry.parts, handles);
      try {
        const stats = await lstat(destination);
        if (!stats.isFile()) throw new Error("Evidence output destination must be a regular file, not a link or directory.");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      prepared.push({ destination, source: entry.source });
    }
    for (const entry of prepared) {
      const temporary = path.join(path.dirname(entry.destination), `.agentship-artifact-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      entry.temporary = temporary;
      handles.push(handle);
      await handle.writeFile(entry.source, "utf8");
    }
    for (const entry of prepared) {
      await rename(entry.temporary!, entry.destination);
      entry.temporary = undefined;
    }
  } finally {
    try {
      await Promise.all(prepared.filter(entry => entry.temporary).map(entry => unlink(entry.temporary!)));
    } finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
  }
}
