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
