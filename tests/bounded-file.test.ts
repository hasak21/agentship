import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { EvidenceReadBudget, readBoundedRegularFile } from "../src/review/bounded-file";

const execFileAsync = promisify(execFile);

test("aggregate budgets charge repeated reads, allow exact boundaries and reserve before concurrent I/O", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-budget-"));
  try {
    const filename = path.join(directory, "input");
    await writeFile(filename, "abc");
    const exact = new EvidenceReadBudget("Fixture", 6);
    assert.equal((await exact.read(filename, "Input", 6)).toString(), "abc");
    assert.equal((await exact.read(filename, "Input", 6)).toString(), "abc");
    await assert.rejects(exact.read(filename, "Input", 6), /Fixture exceeds 6 aggregate byte budget/);
    const concurrent = new EvidenceReadBudget("Concurrent", 3);
    const results = await Promise.allSettled([concurrent.read(filename, "Input", 3), concurrent.read(filename, "Input", 3)]);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
    const clipped = new EvidenceReadBudget("Clipped", 2);
    await assert.rejects(clipped.read(filename, "Input", 6), /Clipped exceeds 2 aggregate byte budget/);
    const invalid = new EvidenceReadBudget("Invalid", 3);
    await assert.rejects(invalid.read(filename, "Input", -1), /Per-file evidence byte limit/);
    assert.equal((await invalid.read(filename, "Input", 3)).length, 3);
    assert.throws(() => new EvidenceReadBudget("Invalid", 64 * 1024 * 1024 + 1), /Evidence byte budget/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("bounded input rejects writerless FIFOs, including linked FIFOs, without waiting for a writer", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX FIFOs only");
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-input-fifo-"));
  try {
    const fifo = path.join(directory, "input");
    const link = path.join(directory, "link");
    await execFileAsync("mkfifo", [fifo]);
    await symlink(fifo, link);
    for (const input of [fifo, link]) {
      // A subprocess timeout bounds the regression even if opening the FIFO blocks.
      const script = `import(${JSON.stringify(new URL("../src/review/bounded-file.ts", import.meta.url).href)}).then(async ({readBoundedRegularFile}) => {
        try { await readBoundedRegularFile(${JSON.stringify(input)}, "Fixture", 1024); process.exitCode = 1; }
        catch (error) { if (!/must be a regular file/.test(error.message)) throw error; console.log("rejected"); }
      });`;
      const result = await execFileAsync(process.execPath, ["--import", "tsx", "-e", script], { timeout: 5000 });
      assert.equal(result.stdout.trim(), "rejected");
      for (const [module, call] of [
        ["baseline", `api.loadBaseline(${JSON.stringify(directory)}, ${JSON.stringify(input)})`],
        ["override", `api.loadOverride(${JSON.stringify(directory)}, ${JSON.stringify(input)}, {})`],
      ]) {
        const entrypoint = new URL(`../src/review/${module}.ts`, import.meta.url).href;
        const wrapperScript = `import(${JSON.stringify(entrypoint)}).then(async api => {
          try { await ${call}; process.exitCode = 1; }
          catch (error) { if (!/must be a regular file/.test(error.message)) throw error; console.log("rejected"); }
        });`;
        const wrapper = await execFileAsync(process.execPath, ["--import", "tsx", "-e", wrapperScript], { timeout: 5000 });
        assert.equal(wrapper.stdout.trim(), "rejected");
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("bounded input retains regular-file bytes, link compatibility and size limits", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-input-regular-"));
  try {
    const filename = path.join(directory, "input");
    const contents = Buffer.from([0, 1, 255, 10]);
    await writeFile(filename, contents);
    assert.deepEqual(await readBoundedRegularFile(filename, "Fixture", 4), contents);
    await assert.rejects(readBoundedRegularFile(filename, "Fixture", 3), /at most 3 bytes/);
    if (process.platform !== "win32") {
      const link = path.join(directory, "link");
      await symlink(filename, link);
      assert.deepEqual(await readBoundedRegularFile(link, "Fixture", 4), contents);
    }
    await assert.rejects(readBoundedRegularFile(directory, "Fixture", 4), /regular file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
