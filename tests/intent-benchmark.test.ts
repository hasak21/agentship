import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseExternalEvaluationCorpus,
  runIntentBenchmark,
  parseSeededOmissionCases,
} from "../src/review/intent-benchmark";

test("intent benchmark binds aggregate and per-case results to the corpus hash", async () => {
  const fixturePath = new URL(
    "../fixtures/intent/seeded-omission-cases.json",
    import.meta.url
  ).pathname;
  const report = await runIntentBenchmark(fixturePath);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.corpus.cases, 8);
  assert.match(report.corpus.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.metrics.precision, 0.8);
  assert.equal(report.metrics.recall, 0.8);
  assert.equal(report.results.length, 8);
  assert.deepEqual(
    report.results.filter(({ correct }) => !correct).map(({ id }) => id),
    ["prose-only-security-omission", "stale-path-alternative-implementation"]
  );
});

test("intent benchmark rejects duplicate and malformed cases", () => {
  const valid = {
    id: "case-1",
    category: "test",
    requirement: "Pass `check:test`.",
    changedFiles: [],
    omissionExpected: false,
    rationale: "Complete.",
  };
  assert.throws(
    () => parseSeededOmissionCases([valid, valid]),
    /duplicated/
  );
  assert.throws(
    () => parseSeededOmissionCases([{ ...valid, omissionExpected: "no" }]),
    /must be boolean/
  );
});

function externalCorpus() {
  return {
    schemaVersion: 1,
    kind: "external_evaluation",
    provenance: {
      dataset: "SWE-bench/SWE-bench_Verified",
      revision: "a".repeat(40),
      datasetSha256: "1".repeat(64),
      predictionsSha256: "2".repeat(64),
      split: "test",
      sourceUrl: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
      selection: "Two deterministic fixture rows for parser coverage only.",
      retrievedAt: "2026-10-10",
    },
    cases: [
      {
        id: "external-complete",
        category: "externally evaluated complete change",
        requirement: "Add regression tests for the issue.",
        changedFiles: ["testing/test_regression.py"],
        omissionExpected: false,
        rationale: "The external evaluator marked this candidate resolved.",
        source: {
          instanceId: "project__repository-1",
          repository: "project/repository",
          baseCommit: "b".repeat(40),
          candidate: "model/run-1",
          predictionSha256: "c".repeat(64),
          outcomeSha256: "d".repeat(64),
          outcomeEvidence: "https://example.com/evaluations/run-1",
        },
      },
      {
        id: "external-omitted",
        category: "externally evaluated incomplete change",
        requirement: "Add regression tests for the issue.",
        changedFiles: ["src/behavior.py"],
        omissionExpected: true,
        rationale: "The external evaluator marked this candidate unresolved.",
        source: {
          instanceId: "project__repository-1",
          repository: "project/repository",
          baseCommit: "b".repeat(40),
          candidate: "model/run-2",
          predictionSha256: "e".repeat(64),
          outcomeSha256: "f".repeat(64),
          outcomeEvidence: "https://example.com/evaluations/run-2",
        },
      },
    ],
  };
}

test("external benchmark preserves corpus and per-candidate provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-external-corpus-"));
  try {
    const fixturePath = path.join(root, "external.json");
    await writeFile(fixturePath, `${JSON.stringify(externalCorpus())}\n`, "utf8");
    const report = await runIntentBenchmark(fixturePath);
    assert.equal(report.corpus.kind, "external_evaluation");
    assert.equal(report.corpus.provenance?.dataset, "SWE-bench/SWE-bench_Verified");
    assert.equal(report.corpus.provenance?.revision, "a".repeat(40));
    assert.equal(report.results[0].source?.candidate, "model/run-1");
    assert.equal(report.results[1].source?.outcomeEvidence, "https://example.com/evaluations/run-2");
    assert.deepEqual(report.metrics, {
      cases: 2,
      truePositives: 1,
      trueNegatives: 0,
      falsePositives: 1,
      falseNegatives: 0,
      accuracy: 0.5,
      precision: 0.5,
      recall: 1,
      falsePositiveRate: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("external corpus rejects mutable, credentialed, and duplicate provenance", () => {
  const mutable = externalCorpus();
  mutable.provenance.revision = "main";
  assert.throws(
    () => parseExternalEvaluationCorpus(mutable),
    /full 40-character commit or 64-character digest/
  );

  const credentialed = externalCorpus();
  credentialed.cases[0].source.outcomeEvidence = "https://token@example.com/result";
  assert.throws(
    () => parseExternalEvaluationCorpus(credentialed),
    /credential-free HTTPS URL/
  );

  const unhashed = externalCorpus();
  unhashed.cases[0].source.predictionSha256 = "unknown";
  assert.throws(
    () => parseExternalEvaluationCorpus(unhashed),
    /predictionSha256 must be SHA-256/
  );

  const duplicate = externalCorpus();
  duplicate.cases[1].source.candidate = duplicate.cases[0].source.candidate;
  assert.throws(
    () => parseExternalEvaluationCorpus(duplicate),
    /candidate 'model\/run-1' is duplicated/
  );

  const impossibleDate = externalCorpus();
  impossibleDate.provenance.retrievedAt = "2026-02-30";
  assert.throws(
    () => parseExternalEvaluationCorpus(impossibleDate),
    /ISO calendar date/
  );
});

test("intent benchmark bounds files even when called outside the CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-bounded-corpus-"));
  try {
    const fixturePath = path.join(root, "oversized.json");
    await writeFile(fixturePath, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    await assert.rejects(runIntentBenchmark(fixturePath), /at most 5242880 bytes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
