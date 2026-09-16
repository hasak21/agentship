import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateIntentFixtures, type IntentFixtureCase } from "../src/review/intent-evaluator";

test("explicit-path corpus reports reproducible omission metrics", async () => {
  const source = await readFile(
    new URL("../fixtures/intent/explicit-path-cases.json", import.meta.url),
    "utf8"
  );
  const fixtures = JSON.parse(source) as IntentFixtureCase[];
  const metrics = evaluateIntentFixtures(fixtures);

  assert.equal(metrics.cases, 6);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.missingPrecision, 1);
  assert.equal(metrics.missingRecall, 1);
  assert.equal(metrics.falsePositives, 0);
  assert.equal(metrics.falseNegatives, 0);
});
