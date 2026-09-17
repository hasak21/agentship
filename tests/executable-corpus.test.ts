import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  executePatchCase,
  parseExecutableCorpus,
} from "../src/review/executable-corpus";
import { runIntentBenchmark } from "../src/review/intent-benchmark";

const fixtureUrl = new URL(
  "../fixtures/intent/executable-patch-corpus.json",
  import.meta.url
);

test("executable corpus derives outcomes from safe file oracles", async () => {
  const corpus = parseExecutableCorpus(
    JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown
  );
  assert.equal(corpus.cases.length, 12);

  const omitted = executePatchCase(
    corpus.cases.find(({ id }) => id === "auth-expiry-omitted")!
  );
  assert.equal(omitted.oracle.passed, false);
  assert.equal(omitted.evaluationCase.omissionExpected, true);
  assert.deepEqual(omitted.evaluationCase.changedFiles, ["src/auth/session.ts"]);

  const complete = executePatchCase(
    corpus.cases.find(({ id }) => id === "regression-test-complete")!
  );
  assert.equal(complete.oracle.passed, true);
  assert.match(complete.evaluationCase.diff ?? "", /\+test\("discount"/);
});

test("executable benchmark reports oracle evidence and measured blind spots", async () => {
  const report = await runIntentBenchmark(fixtureUrl.pathname);
  assert.equal(report.corpus.kind, "executable_patch");
  assert.equal(report.corpus.cases, 12);
  assert.deepEqual(report.metrics, {
    cases: 12,
    truePositives: 4,
    trueNegatives: 4,
    falsePositives: 2,
    falseNegatives: 2,
    accuracy: 2 / 3,
    precision: 2 / 3,
    recall: 2 / 3,
    falsePositiveRate: 1 / 3,
  });
  assert.equal(report.results.every(({ oracle }) => oracle !== undefined), true);
  assert.deepEqual(
    report.results.filter(({ correct }) => !correct).map(({ id }) => id),
    [
      "auth-expiry-omitted",
      "stale-path-valid-replacement",
      "unconventional-test-location",
      "documentation-content-omitted",
    ]
  );
});

test("executable corpus rejects unsafe paths and arbitrary oracle types", () => {
  const base = {
    schemaVersion: 1,
    kind: "executable_patch",
    cases: [
      {
        id: "unsafe",
        category: "invalid",
        requirement: "Change a file.",
        rationale: "Validation fixture.",
        baseFiles: {},
        patch: { "../outside.ts": "bad" },
        oracle: [{ type: "shell", path: "../outside.ts" }],
      },
    ],
  };
  assert.throws(() => parseExecutableCorpus(base), /repository-relative/);

  const invalidOracle = {
    ...base,
    cases: [
      {
        ...base.cases[0],
        patch: { "src/safe.ts": "safe" },
        oracle: [{ type: "shell", path: "src/safe.ts" }],
      },
    ],
  };
  assert.throws(() => parseExecutableCorpus(invalidOracle), /type is invalid/);
});
