import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { diagnoseRepository, initializeRepository } from "../src/review/onboarding";
import { initializeCi } from "../src/review/ci-onboarding";

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

test("ci-init creates pinned report-only trust files without overwriting", async () => {
  const root = await repository();
  const verifierRef = "a".repeat(40);
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { lint: "eslint", test: "node --test", dev: "next dev" },
    }));
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    const result = await initializeCi(root, "example/agentship", verifierRef);
    assert.deepEqual(result.checks, ["lint", "test"]);
    assert.deepEqual(result.files, [
      ".agentship.ci.yml",
      ".github/workflows/agentship-report.yml",
      ".github/workflows/agentship-publish-check.yml",
    ]);

    const policySource = await readFile(path.join(root, ".agentship.ci.yml"), "utf8");
    const policy = parse(policySource);
    assert.equal(policy.mode, "report");
    assert.ok(policy.checks.every(({ isolation }: { isolation: string }) => isolation === "bubblewrap"));
    const report = await readFile(
      path.join(root, ".github/workflows/agentship-report.yml"),
      "utf8"
    );
    const publisher = await readFile(
      path.join(root, ".github/workflows/agentship-publish-check.yml"),
      "utf8"
    );
    assert.match(report, new RegExp(`example/agentship/.github/workflows/agentship-report-reusable.yml@${verifierRef}`));
    assert.match(publisher, new RegExp(`example/agentship/.github/workflows/agentship-publish-check-reusable.yml@${verifierRef}`));
    assert.match(report, /permissions:\n  contents: read/);
    assert.match(publisher, /attestations: write/);

    await assert.rejects(
      initializeCi(root, "example/agentship", verifierRef),
      /never overwrites CI trust files/
    );
    assert.equal(await readFile(path.join(root, ".agentship.ci.yml"), "utf8"), policySource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ci-init requires an immutable verifier ref and npm lockfile", async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
    }));
    await assert.rejects(
      initializeCi(root, "example/agentship", "main"),
      /full 40-character commit SHA/
    );
    await assert.rejects(
      initializeCi(root, "example/agentship", "b".repeat(40)),
      /requires package-lock.json or npm-shrinkwrap.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ci-init rejects workflow directories redirected through symbolic links", async () => {
  const root = await repository();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentship-onboarding-outside-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
    }));
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await mkdir(path.join(root, ".github"));
    await symlink(outside, path.join(root, ".github", "workflows"));
    await assert.rejects(
      initializeCi(root, "example/agentship", "d".repeat(40)),
      /must be a real directory inside the repository/
    );
    await assert.rejects(readFile(path.join(outside, "agentship-report.yml")), /ENOENT/);
    await assert.rejects(readFile(path.join(root, ".agentship.ci.yml")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
