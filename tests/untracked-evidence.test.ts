import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { collectUntrackedManifest } from "../src/review/untracked-evidence";

const exec = promisify(execFile);
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-untracked-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function records(manifest: string) {
  return manifest.split("\n").map(line => JSON.parse(line.slice("untracked:".length)));
}

test("untracked evidence streams regular files and records broken link targets without reading them", async () => fixture(async root => {
  await writeFile(path.join(root, "file.ts"), "source bytes");
  await symlink("missing-target", path.join(root, "broken"));
  const rows = records(await collectUntrackedManifest(root, ["file.ts", "broken"]));
  assert.equal(rows[0].sha256, createHash("sha256").update("source bytes").digest("hex"));
  assert.equal(rows[1].kind, "symlink");
  assert.equal(rows[1].sha256, createHash("sha256").update("missing-target").digest("hex"));
  if (process.platform !== "win32") {
    const target = Buffer.from([0x6d, 0x80]);
    await symlink(target, path.join(root, "raw-link"));
    const raw = records(await collectUntrackedManifest(root, ["raw-link"]))[0];
    assert.equal(raw.bytes, target.length);
    assert.equal(raw.sha256, createHash("sha256").update(target).digest("hex"));
  }
  await chmod(path.join(root, "file.ts"), 0o755);
  assert.equal(records(await collectUntrackedManifest(root, ["file.ts"]))[0].mode, 0o755);
}));

test("untracked evidence refuses special entries, hardlinks and linked ancestors", async () => fixture(async root => {
  await mkdir(path.join(root, "directory"));
  await writeFile(path.join(root, "directory/file"), "bytes");
  await symlink("directory", path.join(root, "alias"));
  await link(path.join(root, "directory/file"), path.join(root, "hardlink"));
  await assert.rejects(collectUntrackedManifest(root, ["directory"]), /regular/);
  await assert.rejects(collectUntrackedManifest(root, ["hardlink"]), /single-link/);
  await assert.rejects(collectUntrackedManifest(root, ["alias/file"]));
  if (process.platform !== "win32") {
    await exec("mkfifo", [path.join(root, "pipe")]);
    await assert.rejects(collectUntrackedManifest(root, ["pipe"]), /regular/);
  }
}));

test("untracked evidence bounds counts, per-file bytes and aggregate bytes", async () => fixture(async root => {
  await assert.rejects(collectUntrackedManifest(root, Array.from({ length: 10_001 }, (_, index) => `${index}`)), /at most/);
  await assert.rejects(collectUntrackedManifest(root, ["x", "x"]), /unique/);
  await assert.rejects(collectUntrackedManifest(root, ["../outside"]), /relative/);
  const files = ["a", "b", "c", "d", "e"];
  for (const file of files) {
    await writeFile(path.join(root, file), "");
    await truncate(path.join(root, file), 32 * 1024 * 1024);
  }
  await assert.rejects(collectUntrackedManifest(root, files), /128 MiB/);
  await truncate(path.join(root, "a"), 32 * 1024 * 1024 + 1);
  await assert.rejects(collectUntrackedManifest(root, ["a"]), /32 MiB/);
}));

test("untracked JSON records cannot inject diff headers through filenames", async () => fixture(async root => {
  const name = 'file\ndiff --git a/fake b/fake\n+++ injected.ts\t"';
  // Slashes would create nested paths; use newlines and header-like text as one name.
  const leaf = name.replaceAll("/", "_");
  await writeFile(path.join(root, leaf), "source");
  const manifest = await collectUntrackedManifest(root, [leaf]);
  assert.equal(manifest.split("\n").length, 1);
  assert.equal(records(manifest)[0].path, leaf);
}));
