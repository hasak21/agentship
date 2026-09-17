import test from "node:test";
import assert from "node:assert/strict";
import { runIntentBenchmark, parseSeededOmissionCases } from "../src/review/intent-benchmark";

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
