import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importSweBenchCorpus } from "../src/review/external-corpus-import";

const INSTANCE = "project__repository-1";
const PATCH = [
  "diff --git a/src/behavior.py b/src/behavior.py",
  "index 1111111..2222222 100644",
  "--- a/src/behavior.py",
  "+++ b/src/behavior.py",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-swebench-import-"));
  const reportsDirectory = path.join(root, "logs");
  await mkdir(path.join(reportsDirectory, INSTANCE), { recursive: true });
  const datasetPath = path.join(root, "dataset.jsonl");
  const predictionsPath = path.join(root, "all_preds.jsonl");
  const reportPath = path.join(reportsDirectory, INSTANCE, "report.json");
  await writeFile(
    datasetPath,
    `${JSON.stringify({
      instance_id: INSTANCE,
      repo: "project/repository",
      base_commit: "a".repeat(40),
      problem_statement: "Update the behavior and add regression coverage.",
    })}\n`
  );
  await writeFile(
    predictionsPath,
    `${JSON.stringify({
      instance_id: INSTANCE,
      model_name_or_path: "example-model",
      model_patch: PATCH,
    })}\n`
  );
  const writeReport = async (resolved: boolean, infraFailure = false) => {
    const source = `${JSON.stringify({
      [INSTANCE]: { resolved, infra_failure: infraFailure },
    })}\n`;
    await writeFile(reportPath, source);
    return source;
  };
  await writeReport(false);
  const run = () =>
    importSweBenchCorpus({
      datasetPath,
      predictionsPath,
      reportsDirectory,
      candidateRun: "public-run",
      evidenceBaseUrl: `https://github.com/example/results/blob/${"b".repeat(40)}/`,
      provenance: {
        dataset: "SWE-bench/SWE-bench_Verified",
        revision: "c".repeat(40),
        split: "test",
        sourceUrl: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
        selection: "Every prediction in a hash-pinned public run.",
        retrievedAt: "2026-10-10",
      },
    });
  return { root, run, writeReport };
}

test("SWE-bench importer joins tasks, predictions, and outcome evidence", async () => {
  const { root, run, writeReport } = await fixture();
  try {
    const reportSource = await writeReport(false);
    const imported = await run();
    assert.deepEqual(imported.outcomes, { resolved: 0, unresolved: 1 });
    assert.equal(imported.inputs.reports, 1);
    assert.match(imported.inputs.datasetSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(imported.corpus.cases[0].changedFiles, ["src/behavior.py"]);
    assert.equal(imported.corpus.cases[0].omissionExpected, true);
    assert.equal(
      imported.corpus.cases[0].source.predictionSha256,
      createHash("sha256").update(PATCH).digest("hex")
    );
    assert.equal(
      imported.corpus.cases[0].source.outcomeSha256,
      createHash("sha256").update(reportSource).digest("hex")
    );
    assert.equal(
      imported.corpus.cases[0].source.outcomeEvidence,
      `https://github.com/example/results/blob/${"b".repeat(40)}/logs/${INSTANCE}/report.json`
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SWE-bench importer excludes infrastructure failures", async () => {
  const { root, run, writeReport } = await fixture();
  try {
    await writeReport(false, true);
    await assert.rejects(run(), /infrastructure failure/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
