import test from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureArtifactDirectory, writeEvidenceArtifacts } from "../src/review/artifact-output";
import { prepareHistoryDirectory } from "../src/review/history";

async function fixture(run: (repository: string, outside: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-artifacts-"));
  const repository = path.join(root, "repository");
  const outside = path.join(root, "outside");
  try {
    await mkdir(repository);
    await mkdir(outside);
    await run(repository, outside);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("artifact publication creates nested private reports and replaces regular files atomically", async () => fixture(async repository => {
  const artifacts = ["json", "md", "sarif"].map(extension => ({ path: `reports/nested/ci.${extension}`, source: extension }));
  await writeEvidenceArtifacts(repository, artifacts);
  await writeEvidenceArtifacts(repository, [{ path: artifacts[0].path, source: "updated" }]);
  assert.equal(await readFile(path.join(repository, artifacts[0].path), "utf8"), "updated");
  assert.equal((await stat(path.join(repository, artifacts[0].path))).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(path.join(repository, "reports/nested"))).sort(), ["ci.json", "ci.md", "ci.sarif"]);
}));

test("artifact preflight rejects linked leaves before publishing other batch members", async () => fixture(async (repository, outside) => {
  await writeFile(path.join(repository, "ci.json"), "old report");
  await writeFile(path.join(outside, "sentinel"), "outside sentinel");
  await symlink(path.join(outside, "sentinel"), path.join(repository, "ci.md"));
  await assert.rejects(writeEvidenceArtifacts(repository, [
    { path: "ci.json", source: "new report" }, { path: "ci.md", source: "new markdown" },
  ]), /not a link/);
  assert.equal(await readFile(path.join(repository, "ci.json"), "utf8"), "old report");
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "outside sentinel");
  assert.deepEqual((await readdir(repository)).sort(), ["ci.json", "ci.md"]);
}));

test("artifact and history creation cannot create directories through link ancestors", async () => fixture(async (repository, outside) => {
  await symlink(outside, path.join(repository, "redirect"));
  await assert.rejects(writeEvidenceArtifacts(repository, [{ path: "redirect/new/report.json", source: "report" }]));
  await assert.rejects(ensureArtifactDirectory(repository, "redirect/new/history"));
  await assert.rejects(prepareHistoryDirectory(repository, "redirect/new/history"));
  assert.deepEqual(await readdir(outside), []);
}));

test("artifact replacement does not mutate external hardlink names", async () => fixture(async (repository, outside) => {
  await writeFile(path.join(outside, "sentinel"), "outside sentinel");
  await link(path.join(outside, "sentinel"), path.join(repository, "ci.json"));
  await writeEvidenceArtifacts(repository, [{ path: "ci.json", source: "report" }]);
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "outside sentinel");
  assert.equal(await readFile(path.join(repository, "ci.json"), "utf8"), "report");
}));

test("artifact outputs reject escapes, administration paths, directory targets and duplicates", async () => fixture(async (repository, outside) => {
  for (const output of ["..", "../outside/report.json", path.join(outside, "report.json"), ".git/config", "nested/.git/config"]) {
    await assert.rejects(writeEvidenceArtifacts(repository, [{ path: output, source: "report" }]), /repository child/);
  }
  await assert.rejects(writeEvidenceArtifacts(repository, [{ path: "a", source: "one" }, { path: "a", source: "two" }]), /unique/);
  await mkdir(path.join(repository, "directory"));
  await assert.rejects(writeEvidenceArtifacts(repository, [{ path: "directory", source: "report" }]), /regular file/);
  assert.deepEqual(await readdir(outside), []);
}));
