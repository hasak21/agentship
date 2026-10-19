import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureCalibration } from "../src/review/calibration";
import { recordFindingOutcome } from "../src/review/outcome";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const HOUR = 60 * 60 * 1000;

const findings = [
  { id: "block-confirmed", kind: "required_check_failed", severity: "blocker", title: "Confirmed blocker" },
  { id: "block-rejected", kind: "required_check_failed", severity: "blocker", title: "False blocker" },
  { id: "warning-confirmed", kind: "optional_check_failed", severity: "warning", title: "Confirmed warning" },
  {
    id: "warning-overridden",
    kind: "optional_check_failed",
    severity: "warning",
    title: "Overridden then fixed",
    override: {
      id: "release-exception",
      actor: "release-manager@example.com",
      reason: "Temporary exception.",
      expiresAt: "2026-10-01",
      reportSha256: SHA_A,
    },
  },
];

function report(runId: string, finishedAt: string, head: string, reportFindings: unknown[]) {
  return {
    schemaVersion: 1,
    runId,
    finishedAt,
    repository: {
      head,
      diffSha256: head === "source-head" ? SHA_A : SHA_B,
      reviewScope: "working-tree",
    },
    configuration: { sha256: SHA_A },
    findings: reportFindings,
  };
}

async function withCalibrationFixture(
  run: (fixture: {
    root: string;
    sourcePath: string;
    resolutionPath: string;
    measure: () => ReturnType<typeof measureCalibration>;
  }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-calibration-"));
  try {
    await mkdir(path.join(root, "reports"), { recursive: true });
    await mkdir(path.join(root, "outcomes"), { recursive: true });
    const sourcePath = "reports/source.json";
    const resolutionPath = "reports/resolution.json";
    await writeFile(
      path.join(root, sourcePath),
      `${JSON.stringify(report("source-run", "2026-09-24T00:00:00.000Z", "source-head", findings))}\n`,
      "utf8"
    );
    await writeFile(
      path.join(root, resolutionPath),
      `${JSON.stringify(report("resolution-run", "2026-09-24T01:00:00.000Z", "resolution-head", []))}\n`,
      "utf8"
    );
    await writeFile(
      path.join(root, "corpus.json"),
      await readFile(path.resolve("fixtures/intent/executable-patch-corpus.json"))
    );

    const record = async (
      findingId: string,
      findingKind: string,
      status: "accepted" | "rejected" | "fixed" | "overridden",
      hour: number,
      id: string
    ) => recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        ...(status === "fixed" ? { resolutionReportPath: resolutionPath } : {}),
        findingId,
        findingKind,
        status,
        actor: "calibrator@example.com",
        reason: `Calibration disposition ${status}.`,
        outputDirectory: "outcomes",
      },
      new Date(Date.parse("2026-09-24T00:00:00.000Z") + hour * HOUR),
      id
    );
    await record("block-confirmed", "required_check_failed", "accepted", 1, "accepted-block");
    await record("block-confirmed", "required_check_failed", "fixed", 3, "fixed-block");
    await record("block-rejected", "required_check_failed", "rejected", 2, "rejected-block");
    await record("warning-confirmed", "optional_check_failed", "accepted", 4, "accepted-warning");
    await record("warning-overridden", "optional_check_failed", "overridden", 5, "override-warning");
    await record("warning-overridden", "optional_check_failed", "fixed", 6, "fixed-warning");

    const measure = () => measureCalibration(
      {
        repositoryRoot: root,
        outcomesDirectory: "outcomes",
        reportsDirectory: "reports",
        benchmarkFixturePath: "corpus.json",
      },
      new Date("2026-09-25T00:00:00.000Z")
    );
    await run({ root, sourcePath, resolutionPath, measure });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("calibration derives reproducible metrics from three evidence sets", async () => {
  await withCalibrationFixture(async ({ measure }) => {
    const result = await measure();
    assert.deepEqual(result.samples, {
      reviews: 2,
      trackedFindings: 4,
      adjudicatedFindings: 4,
      adjudicatedBlockers: 2,
    });
    assert.deepEqual(result.precision, {
      allFindings: 0.75,
      blockers: 0.5,
      confirmed: 3,
      rejected: 1,
    });
    assert.equal(result.recall.omissions, 2 / 3);
    assert.equal(result.recall.labelSemantics, "file_oracle_omission");
    assert.equal(result.recall.taskResolutionProxy, null);
    assert.equal(result.recall.cases, 12);
    assert.deepEqual(result.falseBlocks, { count: 1, per100Reviews: 50 });
    assert.deepEqual(result.triage, { samples: 4, medianMs: 3 * HOUR });
    assert.deepEqual(result.overrides, {
      count: 1,
      rate: 0.25,
      subsequentlyAccepted: 0,
      subsequentlyRejected: 0,
      subsequentlyFixed: 1,
    });
    assert.match(result.inputs.outcomes.sha256, /^[a-f0-9]{64}$/);
    assert.match(result.inputs.reports.sha256, /^[a-f0-9]{64}$/);
    assert.match(result.inputs.benchmark.sha256, /^[a-f0-9]{64}$/);
  });
});

test("calibration refuses replacement-decodable JSON before using outcome or report fields", async () => {
  await withCalibrationFixture(async ({ root, sourcePath, measure }) => {
    for (const filename of [path.join("outcomes", (await readdir(path.join(root, "outcomes")))[0]), sourcePath]) {
      const absolute = path.join(root, filename);
      const original = await readFile(absolute);
      // Add an ordinary extra field so malformed bytes, not structural validity or binding, cause refusal.
      const invalid = Buffer.concat([Buffer.from('{"encoding":"'), Buffer.from([0xff]), Buffer.from('",'), original.subarray(1)]);
      await writeFile(absolute, invalid);
      await assert.rejects(measure(), /(?:Outcome|Review report).*must contain valid UTF-8/);
      await writeFile(absolute, original);
    }
    assert.equal((await measure()).samples.reviews, 2);
  });
});

test("calibration rejects an aggregate report corpus that exceeds 64 MiB before returning metrics", async () => {
  await withCalibrationFixture(async ({ root, measure }) => {
    const padding = "x".repeat(2 * 1024 * 1024);
    for (let index = 0; index < 33; index++) {
      await writeFile(path.join(root, "reports", `bulk-${index}.json`), JSON.stringify({
        ...report(`bulk-${index}`, "2026-09-24T00:00:00.000Z", "head", []), padding,
      }));
    }
    await assert.rejects(measure(), /Calibration evidence exceeds 67108864 aggregate byte budget/);
  });
});

test("calibration retains external benchmark provenance", async () => {
  await withCalibrationFixture(async ({ root, measure }) => {
    const provenance = {
      dataset: "SWE-bench/SWE-bench_Verified",
      revision: "c".repeat(40),
      datasetSha256: "1".repeat(64),
      predictionsSha256: "2".repeat(64),
      split: "test",
      sourceUrl: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
      selection: "One deterministic parser fixture; not a representative sample.",
      retrievedAt: "2026-10-10",
    };
    await writeFile(
      path.join(root, "corpus.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "external_evaluation",
        provenance,
        cases: [
          {
            id: "external-incomplete",
            category: "externally evaluated incomplete change",
            requirement: "Add regression tests for the issue.",
            changedFiles: ["src/behavior.py"],
            omissionExpected: true,
            rationale: "The external evaluator marked this candidate unresolved.",
            source: {
              instanceId: "project__repository-1",
              repository: "project/repository",
              baseCommit: "d".repeat(40),
              candidate: "model/run-1",
              predictionSha256: "e".repeat(64),
              outcomeSha256: "f".repeat(64),
              outcomeEvidence: "https://example.com/evaluations/run-1",
            },
          },
        ],
      })}\n`,
      "utf8"
    );

    const result = await measure();
    assert.equal(result.inputs.benchmark.kind, "external_evaluation");
    assert.deepEqual(result.inputs.benchmark.provenance, provenance);
    assert.equal(result.inputs.benchmark.labelSemantics, "task_resolution_proxy");
    assert.equal(result.recall.omissions, null);
    assert.equal(result.recall.taskResolutionProxy, 1);
    assert.equal(result.recall.labelSemantics, "task_resolution_proxy");
  });
});

test("calibration rejects conflicting finding dispositions", async () => {
  await withCalibrationFixture(async ({ root, sourcePath, measure }) => {
    await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: "block-confirmed",
        findingKind: "required_check_failed",
        status: "rejected",
        actor: "second-reviewer@example.com",
        reason: "Conflicting adjudication.",
        outputDirectory: "outcomes",
      },
      new Date("2026-09-24T07:00:00.000Z"),
      "conflicting-rejection"
    );
    await assert.rejects(measure(), /conflicting confirmed and rejected/);
  });
});

test("calibration rejects source report tampering and missing denominators", async () => {
  await withCalibrationFixture(async ({ root, sourcePath, measure }) => {
    const source = JSON.parse(await readFile(path.join(root, sourcePath), "utf8"));
    source.repository.head = "tampered-head";
    await writeFile(path.join(root, sourcePath), JSON.stringify(source), "utf8");
    await assert.rejects(measure(), /source report is absent/);
  });
});

test("calibration evidence directories must stay inside the repository", async () => {
  await withCalibrationFixture(async ({ root }) => {
    await assert.rejects(
      measureCalibration({
        repositoryRoot: root,
        outcomesDirectory: "../outcomes",
        reportsDirectory: "reports",
        benchmarkFixturePath: "corpus.json",
      }),
      /within the repository/
    );
  });
});
