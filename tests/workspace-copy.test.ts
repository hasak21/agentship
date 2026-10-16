import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, readlink, readdir, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prepareBubblewrapSandbox, type PreparedSandbox } from "../src/review/sandbox";
import { copySandboxWorkspace } from "../src/review/workspace-copy";

const exec = promisify(execFile);

test("sandbox preparation rejects tracked files beneath a replaced directory symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-workspace-link-"));
  const repository = path.join(root, "repository");
  const outside = path.join(root, "outside");
  let sandbox: PreparedSandbox | undefined;
  try {
    await mkdir(path.join(repository, "fixtures"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(repository, "fixtures/file.txt"), "tracked fixture");
    await writeFile(path.join(outside, "file.txt"), "outside sentinel");
    await exec("git", ["init", "-q"], { cwd: repository });
    await exec("git", ["add", "."], { cwd: repository });
    await rm(path.join(repository, "fixtures"), { recursive: true });
    await symlink(outside, path.join(repository, "fixtures"));
    await assert.rejects(async () => {
      sandbox = await prepareBubblewrapSandbox({ name: "test", run: "true", isolation: "bubblewrap" }, repository);
    }, { code: "ENOTDIR" });
    assert.equal(await readFile(path.join(outside, "file.txt"), "utf8"), "outside sentinel");
  } finally {
    await sandbox?.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(run: (repository: string, destination: string, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-workspace-copy-"));
  const repository = path.join(root, "repository");
  try {
    await mkdir(repository);
    await exec("git", ["init", "-q"], { cwd: repository });
    await run(repository, path.join(root, "workspace"), root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("workspace copy preserves tracked/untracked files, link bytes and executable mode", async () => fixture(async (repository, destination) => {
  await mkdir(path.join(repository, "nested"));
  await writeFile(path.join(repository, "nested/test.sh"), "exit 0\n");
  await chmod(path.join(repository, "nested/test.sh"), 0o755);
  await writeFile(path.join(repository, ".gitignore"), "secret\n");
  await exec("git", ["add", "."], { cwd: repository });
  await writeFile(path.join(repository, "secret"), "not copied");
  await writeFile(path.join(repository, "untracked.ts"), "source");
  await symlink("nested/test.sh", path.join(repository, "alias"));
  await symlink(Buffer.from([0x6d, 0x80]), path.join(repository, "raw-link"));
  for (const name of ["node_modules", ".agentship"]) {
    await mkdir(path.join(repository, name));
    await writeFile(path.join(repository, name, "omitted"), "not copied");
  }
  await copySandboxWorkspace(repository, destination);
  assert.equal(await readFile(path.join(destination, "nested/test.sh"), "utf8"), "exit 0\n");
  assert.equal((await stat(path.join(destination, "nested/test.sh"))).mode & 0o777, 0o755);
  assert.equal(await readFile(path.join(destination, "untracked.ts"), "utf8"), "source");
  assert.equal(await readlink(path.join(destination, "alias")), "nested/test.sh");
  assert.deepEqual(await readlink(path.join(destination, "raw-link"), { encoding: "buffer" }), Buffer.from([0x6d, 0x80]));
  for (const name of ["secret", ".git", ".agentship", "node_modules"]) {
    await assert.rejects(stat(path.join(destination, name)), { code: "ENOENT" });
  }
}));

test("workspace copy skips tracked deletions and keeps hostile names as literal paths", async () => fixture(async (repository, destination) => {
  await mkdir(path.join(repository, "deleted"));
  await writeFile(path.join(repository, "deleted/file"), "old");
  await exec("git", ["add", "."], { cwd: repository });
  await rm(path.join(repository, "deleted"), { recursive: true });
  const name = 'name\nwith\t"quotes" ';
  await writeFile(path.join(repository, name), "literal contents");
  await copySandboxWorkspace(repository, destination);
  assert.deepEqual(await readdir(destination), [name]);
  assert.equal(await readFile(path.join(destination, name), "utf8"), "literal contents");
}));

test("workspace copy refuses pre-existing destination links without touching their targets", async () => fixture(async (repository, destination, root) => {
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel"), "original");
  await writeFile(path.join(repository, "sentinel"), "candidate");
  await symlink(outside, destination);
  await assert.rejects(copySandboxWorkspace(repository, destination), { code: "EEXIST" });
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "original");
}));

test("workspace copy rejects linked regular sources and tracked FIFOs before reading", async () => {
  for (const kind of ["hardlink", "fifo"] as const) await fixture(async (repository, destination, root) => {
    await writeFile(path.join(repository, "source"), "original");
    await exec("git", ["add", "source"], { cwd: repository });
    if (kind === "hardlink") await link(path.join(repository, "source"), path.join(root, "outside"));
    else {
      await rm(path.join(repository, "source"));
      await exec("mkfifo", [path.join(repository, "source")]);
    }
    await assert.rejects(copySandboxWorkspace(repository, destination), /single-link regular/);
  });
});

test("workspace copy enforces real entry/byte bounds and never accepts looser overrides", async () => fixture(async (repository, destination) => {
  await writeFile(path.join(repository, "a"), "123456");
  await writeFile(path.join(repository, "b"), "123456");
  await assert.rejects(copySandboxWorkspace(repository, destination, { maxEntries: 1 }), /unique filesystem entries/);
  await assert.rejects(copySandboxWorkspace(repository, destination, { maxBytes: 8 }), /copied bytes/);
  assert.deepEqual(await readdir(destination), ["a"]);
  for (const limits of [{ maxBytes: 3 * 1024 ** 3 }, { maxEntries: 200_001 }, { maxBytes: 0 }]) {
    await assert.rejects(copySandboxWorkspace(repository, destination, limits), /only tighten/);
  }
}));

test("workspace copy rejects a sparse source over the production 2 GiB limit", async () => fixture(async (repository, destination) => {
  await writeFile(path.join(repository, "large"), "");
  await truncate(path.join(repository, "large"), 2 * 1024 ** 3 + 1);
  await assert.rejects(copySandboxWorkspace(repository, destination), /copied bytes/);
  assert.deepEqual(await readdir(destination), []);
}));

test("workspace entry budgets include parent directories, not just Git-listed leaves", async () => fixture(async (repository, destination) => {
  await mkdir(path.join(repository, "a/b/c"), { recursive: true });
  await writeFile(path.join(repository, "a/b/c/test.ts"), "test");
  await assert.rejects(copySandboxWorkspace(repository, destination, { maxEntries: 3 }), /including directories/);
  await assert.rejects(stat(destination), { code: "ENOENT" });
}));
