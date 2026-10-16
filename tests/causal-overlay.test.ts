import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { overlayCausalTestFiles } from "../src/review/causal-overlay";

test("causal overlay must not follow base directory symlinks outside the worktree", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-overlay-escape-"));
  const source = path.join(directory, "source");
  const base = path.join(directory, "base");
  const outside = path.join(directory, "outside");
  try {
    await mkdir(path.join(source, "tests"), { recursive: true });
    await mkdir(base);
    await mkdir(outside);
    await writeFile(path.join(source, "tests/case.ts"), "candidate test");
    await writeFile(path.join(outside, "case.ts"), "outside sentinel");
    await symlink(outside, path.join(base, "tests"));
    await assert.rejects(overlayCausalTestFiles(source, base, ["tests/case.ts"], ["tests/**"]));
    assert.equal(await readFile(path.join(outside, "case.ts"), "utf8"), "outside sentinel");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(run: (source: string, base: string, outside: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-overlay-"));
  const [source, base, outside] = ["source", "base", "outside"].map(name => path.join(directory, name));
  try {
    for (const root of [source, base, outside]) await mkdir(root);
    await run(source, base, outside);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

for (const mode of ["source-parent", "source-leaf", "destination-leaf", "deletion-parent"] as const) {
  test(`causal overlay refuses ${mode} symlink traversal`, async () => fixture(async (source, base, outside) => {
    await mkdir(path.join(source, "tests"));
    await mkdir(path.join(base, "tests"));
    await writeFile(path.join(outside, "case.ts"), "outside sentinel");
    if (mode === "source-parent") {
      await rm(path.join(source, "tests"), { recursive: true });
      await symlink(outside, path.join(source, "tests"));
    } else if (mode === "source-leaf") {
      await symlink(path.join(outside, "case.ts"), path.join(source, "tests/case.ts"));
    } else if (mode === "destination-leaf") {
      await writeFile(path.join(source, "tests/case.ts"), "candidate test");
      await symlink(path.join(outside, "case.ts"), path.join(base, "tests/case.ts"));
    } else {
      await rm(path.join(base, "tests"), { recursive: true });
      await symlink(outside, path.join(base, "tests"));
    }
    await assert.rejects(overlayCausalTestFiles(source, base, ["tests/case.ts"], ["tests/**"]));
    assert.equal(await readFile(path.join(outside, "case.ts"), "utf8"), "outside sentinel");
  }));
}

test("causal overlay atomically replaces destination hardlinks without changing other names", async () => fixture(async (source, base, outside) => {
  await writeFile(path.join(source, "case.ts"), "candidate test");
  await writeFile(path.join(outside, "case.ts"), "outside sentinel");
  await link(path.join(outside, "case.ts"), path.join(base, "case.ts"));
  await overlayCausalTestFiles(source, base, ["case.ts"], ["case.ts"]);
  assert.equal(await readFile(path.join(outside, "case.ts"), "utf8"), "outside sentinel");
  assert.equal(await readFile(path.join(base, "case.ts"), "utf8"), "candidate test");
}));

test("causal overlay preserves executable mode, creates nested parents and handles deletions", async () => fixture(async (source, base) => {
  await mkdir(path.join(source, "tests/deep"), { recursive: true });
  await writeFile(path.join(source, "tests/deep/case.sh"), "exit 1\n");
  await chmod(path.join(source, "tests/deep/case.sh"), 0o755);
  await writeFile(path.join(base, "obsolete.ts"), "old test");
  const files = ["tests/deep/case.sh", "obsolete.ts", "missing/deleted.ts"];
  assert.deepEqual(await overlayCausalTestFiles(source, base, files, ["tests/**", "obsolete.ts", "missing/**"]), files);
  assert.equal(await readFile(path.join(base, "tests/deep/case.sh"), "utf8"), "exit 1\n");
  assert.equal((await stat(path.join(base, "tests/deep/case.sh"))).mode & 0o777, 0o755);
  await assert.rejects(stat(path.join(base, "obsolete.ts")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(base, "missing")), { code: "ENOENT" });
}));

test("causal overlays reject unsafe paths, duplicate lists and excessive counts", async () => fixture(async (source, base) => {
  for (const file of ["../escape.ts", "/absolute.ts", "tests/../escape.ts", "tests\\escape.ts", ".git/config", "tests//case.ts"]) {
    await assert.rejects(overlayCausalTestFiles(source, base, [file], [file]), /normalized/);
  }
  await assert.rejects(overlayCausalTestFiles(source, base, ["case.ts", "case.ts"], ["case.ts"]), /unique/);
  await assert.rejects(overlayCausalTestFiles(source, base, Array.from({ length: 257 }, (_, index) => `tests/${index}.ts`), ["tests/**"]), /at most/);
  await assert.rejects(overlayCausalTestFiles(source, base, [], ["tests/**"]), /did not match/);
  await assert.rejects(overlayCausalTestFiles(source, source, ["case.ts"], ["case.ts"]), /distinct/);
}));

test("causal overlays reject multiply linked sources and overlarge files", async () => fixture(async (source, base, outside) => {
  await writeFile(path.join(outside, "secret"), "outside sentinel");
  await link(path.join(outside, "secret"), path.join(source, "linked.ts"));
  await assert.rejects(overlayCausalTestFiles(source, base, ["linked.ts"], ["linked.ts"]), /single-link/);
  await writeFile(path.join(source, "large.ts"), "");
  await truncate(path.join(source, "large.ts"), 16 * 1024 * 1024 + 1);
  await assert.rejects(overlayCausalTestFiles(source, base, ["large.ts"], ["large.ts"]), /at most/);
  assert.deepEqual(await readdir(base), []);
}));

test("causal overlays enforce the aggregate byte budget and remove temporary files", async () => fixture(async (source, base) => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
  for (const file of files) {
    await writeFile(path.join(source, file), "");
    await truncate(path.join(source, file), 16 * 1024 * 1024);
  }
  await assert.rejects(overlayCausalTestFiles(source, base, files, files), /aggregate byte/);
  assert.deepEqual((await readdir(base)).sort(), files.slice(0, 4));
}));
