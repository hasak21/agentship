import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyOmissionAdjudications, createOmissionAdjudicationPacket } from "../src/review/omission-adjudication";
import { prepareOmissionAdjudications, runIntentBenchmark, type ExternalEvaluationCorpus } from "../src/review/intent-benchmark";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function corpus(): ExternalEvaluationCorpus {
  return {
    schemaVersion: 1, kind: "external_evaluation",
    provenance: {
      dataset: "synthetic-review-fixture", revision: "a".repeat(40),
      datasetSha256: "b".repeat(64), predictionsSha256: "c".repeat(64),
      split: "test", sourceUrl: "https://example.com/dataset",
      selection: "Synthetic test only", retrievedAt: "2026-10-16",
    },
    cases: Array.from({ length: 4 }, (_, index) => ({
      id: `case-${index}`, category: "SECRET-outcome", requirement: "Add regression tests.",
      changedFiles: ["src/index.ts"], diff: "", omissionExpected: false,
      rationale: "SECRET-external-rationale",
      source: {
        instanceId: `case-${index}`, repository: "owner/project", baseCommit: "d".repeat(40),
        candidate: "SECRET-model", predictionSha256: digest(""),
        outcomeSha256: "e".repeat(64), outcomeEvidence: "https://example.com/SECRET-report",
      },
    })),
  };
}
function labeled() {
  const source = corpus();
  const packet = createOmissionAdjudicationPacket(source.cases, "f".repeat(64));
  packet.reviewer = "Synthetic reviewer (not a real independent review)";
  packet.cases[0] = { ...packet.cases[0], decision: "omission", rationale: "No regression test in patch", evidence: ["patch:changedFiles"] };
  packet.cases[1] = { ...packet.cases[1], decision: "complete", rationale: "Synthetic counterexample", evidence: ["fixture:case-1"] };
  packet.cases[2] = { ...packet.cases[2], decision: "abstain", rationale: "Insufficient context" };
  return { source, packet };
}

test("review packet excludes outcomes, model identities and detector labels", () => {
  const packet = createOmissionAdjudicationPacket(corpus().cases, "f".repeat(64));
  assert.equal(JSON.stringify(packet).includes("SECRET"), false);
  assert.equal(JSON.stringify(packet).includes("omissionExpected"), false);
  assert.equal(packet.reviewer, "");
  assert.ok(packet.cases.every(row => row.decision === "unreviewed"));
  assert.throws(() => applyOmissionAdjudications(corpus().cases, packet.corpusSha256, packet), /reviewer/);
  packet.reviewer = "fixture";
  assert.throws(() => applyOmissionAdjudications(corpus().cases, packet.corpusSha256, packet), /no decided/);
});

test("only explicit decisions enter metrics and coverage retains exclusions", () => {
  const { source, packet } = labeled();
  const applied = applyOmissionAdjudications(source.cases, packet.corpusSha256, packet);
  assert.deepEqual(applied.cases.map(row => row.omissionExpected), [true, false]);
  assert.deepEqual(applied.coverage, { reviewer: packet.reviewer, total: 4, decided: 2, abstained: 1, unreviewed: 1 });
});

test("review binding rejects mutation, truncation, duplicates and missing evidence", () => {
  const { source, packet } = labeled();
  for (const field of ["requirement", "requirementSha256", "diff", "predictionSha256", "repository", "baseCommit"] as const) {
    const altered = structuredClone(packet);
    altered.cases[0][field] += "changed";
    assert.throws(() => applyOmissionAdjudications(source.cases, packet.corpusSha256, altered), /bound/);
  }
  for (const mutate of [
    (p: typeof packet) => { p.corpusSha256 = "0".repeat(64); },
    (p: typeof packet) => { p.cases.pop(); },
    (p: typeof packet) => { p.cases[1] = p.cases[0]; },
    (p: typeof packet) => { p.cases[0].changedFiles = []; },
    (p: typeof packet) => { p.cases[0].evidence = []; },
    (p: typeof packet) => { p.cases[0].rationale = ""; },
  ]) {
    const altered = structuredClone(packet);
    mutate(altered);
    assert.throws(() => applyOmissionAdjudications(source.cases, packet.corpusSha256, altered));
  }
  source.cases[0].diff = "tampered";
  assert.throws(() => createOmissionAdjudicationPacket(source.cases, packet.corpusSha256), /digest/);
  const invalidDecision = structuredClone(packet) as unknown as { cases: Array<{ decision: unknown }> };
  invalidDecision.cases[0].decision = ["omission"];
  assert.throws(() => applyOmissionAdjudications(corpus().cases, packet.corpusSha256, invalidDecision), /unsupported decision/);
});

test("benchmark distinguishes reviewer assertions from task-resolution proxies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-adjudication-"));
  try {
    const { source, packet } = labeled();
    const fixture = path.join(directory, "corpus.json");
    const labels = path.join(directory, "review.json");
    const content = JSON.stringify(source);
    await writeFile(fixture, content);
    packet.corpusSha256 = digest(content);
    await writeFile(labels, JSON.stringify(packet));
    const prepared = await prepareOmissionAdjudications(fixture);
    assert.equal(prepared.corpusSha256, packet.corpusSha256);
    const report = await runIntentBenchmark(fixture, labels);
    assert.equal(report.corpus.labelSemantics, "reviewer_asserted_omission");
    assert.equal(report.corpus.cases, 4);
    assert.equal(report.metrics.cases, 2);
    assert.equal(report.corpus.adjudication?.decided, 2);
    assert.equal(report.corpus.adjudication?.sha256, digest(JSON.stringify(packet)));
    assert.equal(report.results[0].adjudication?.decision, "omission");
    assert.equal((await runIntentBenchmark(fixture)).corpus.labelSemantics, "task_resolution_proxy");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
