import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { diagnoseRepository, initializeRepository } from "../src/review/onboarding";

const execFileAsync = promisify(execFile);

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-onboarding-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("init derives bounded checks from package scripts without overwriting", async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { lint: "eslint", test: "node --test", unrelated: "echo no" },
    }));
    const result = await initializeRepository(root);
    assert.deepEqual(result.checks, ["lint", "test"]);
    const source = await readFile(path.join(root, ".agentship.yml"), "utf8");
    const config = parse(source);
    assert.equal(config.mode, "report");
    assert.deepEqual(config.checks.map(({ name }: { name: string }) => name), ["lint", "test"]);
    assert.ok(config.checks.every(({ network }: { network: string }) => network === "denied"));
    await assert.rejects(initializeRepository(root), /never overwrites/);
    assert.equal(await readFile(path.join(root, ".agentship.yml"), "utf8"), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init refuses to invent checks when package scripts are absent", async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    await assert.rejects(initializeRepository(root), /must define at least one/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor validates config and explains direct-execution boundaries", async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, ".agentship.yml"), `version: 1
mode: report
checks:
  - name: test
    run: npm test
    network: denied
`);
    const result = await diagnoseRepository(root);
    assert.equal(result.ready, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.checks, [{ name: "test", backend: "direct", ready: true }]);
    assert.ok(result.warnings.some((warning) => /host filesystem/.test(warning)));
    assert.ok(result.warnings.some((warning) => /cannot enforce/.test(warning)));
    assert.match(result.config.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
