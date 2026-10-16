import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateIntentFixtures,
  evaluateSeededOmissions,
  type IntentFixtureCase,
  type SeededOmissionCase,
} from "../src/review/intent-evaluator";

test("explicit-evidence corpus reports reproducible omission metrics", async () => {
  const source = await readFile(
    new URL("../fixtures/intent/explicit-evidence-cases.json", import.meta.url),
    "utf8"
  );
  const fixtures = JSON.parse(source) as IntentFixtureCase[];
  const metrics = evaluateIntentFixtures(fixtures);

  assert.equal(metrics.cases, 17);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.missingPrecision, 1);
  assert.equal(metrics.missingRecall, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.equal(metrics.falseNegatives, 0);
});

test("seeded omission corpus exposes deterministic semantic blind spots", async () => {
  const source = await readFile(
    new URL("../fixtures/intent/seeded-omission-cases.json", import.meta.url),
    "utf8"
  );
  const fixtures = JSON.parse(source) as SeededOmissionCase[];
  const metrics = evaluateSeededOmissions(fixtures);

  assert.deepEqual(metrics, {
    cases: 8,
    truePositives: 4,
    trueNegatives: 2,
    falsePositives: 1,
    falseNegatives: 1,
    accuracy: 0.75,
    precision: 0.8,
    recall: 0.8,
    falsePositiveRate: 1 / 3,
  });
});

test("omission precision is undefined when the detector emits no findings", () => {
  const cases = [{
    id: "no-detection",
    category: "semantic omission",
    requirement: "Reject expired tokens.",
    changedFiles: ["src/session.ts"],
    omissionExpected: true,
    rationale: "A behavior-only omission has no explicit evidence annotation.",
  }];
  const seeded = evaluateSeededOmissions(cases);
  assert.equal(seeded.precision, null);
  assert.equal(seeded.recall, 0);
  const explicit = evaluateIntentFixtures([{
    id: "unmapped",
    requirement: "Reject expired tokens.",
    changedFiles: ["src/session.ts"],
    expectedStatus: "missing",
  }]);
  assert.equal(explicit.missingPrecision, null);
});

test("benchmark rates stay undefined when their truth-label denominator is absent", () => {
  const base = {
    id: "one-label-class",
    category: "denominator fixture",
    requirement: "Preserve behavior.",
    changedFiles: ["src/behavior.ts"],
    rationale: "Check metric semantics without a positive or negative truth class.",
  };
  const allComplete = evaluateSeededOmissions([{ ...base, omissionExpected: false }]);
  assert.equal(allComplete.recall, null);
  assert.equal(allComplete.falsePositiveRate, 0);
  const allIncomplete = evaluateSeededOmissions([{ ...base, omissionExpected: true }]);
  assert.equal(allIncomplete.recall, 0);
  assert.equal(allIncomplete.falsePositiveRate, null);
});
