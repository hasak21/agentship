import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureFindingOutcomes, recordFindingOutcome } from "../src/review/outcome";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function report(options: {
  runId: string;
  finishedAt: string;
  head: string;
  findings: Array<Record<string, unknown>>;
  configurationSha256?: string;
  taskSha256?: string;
}) {
  return {
    schemaVersion: 1,
    runId: options.runId,
    finishedAt: options.finishedAt,
    repository: {
      head: options.head,
      diffSha256: SHA_B,
      reviewScope: "working-tree",
      changedFiles: ["src/example.ts"],
    },
    configuration: { sha256: options.configurationSha256 ?? SHA_A },
    ...(options.taskSha256 ? { task: { sha256: options.taskSha256 } } : {}),
    findings: options.findings,
  };
}

const target = {
  id: "finding-1",
  kind: "required_check_failed",
  severity: "blocker",
  title: "Required check failed",
};

async function withFixture(
  run: (fixture: { root: string; sourcePath: string; resolutionPath: string }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-outcome-"));
  try {
    await mkdir(path.join(root, ".agentship", "reviews"), { recursive: true });
    const sourcePath = ".agentship/reviews/source.json";
    const resolutionPath = ".agentship/reviews/resolution.json";
    await writeFile(
      path.join(root, sourcePath),
      `${JSON.stringify(
        report({
          runId: "source-run",
          finishedAt: "2026-09-24T00:00:00.000Z",
          head: "source-head",
          findings: [target],
        })
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(root, resolutionPath),
      `${JSON.stringify(
        report({
          runId: "resolution-run",
          finishedAt: "2026-09-24T01:00:00.000Z",
          head: "resolution-head",
          findings: [],
        })
      )}\n`,
      "utf8"
    );
    await run({ root, sourcePath, resolutionPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepted outcome is immutable and binds the exact source report", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const result = await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: target.id,
        findingKind: target.kind,
        status: "accepted",
        actor: "maintainer@example.com",
        reason: "Reproduced locally.",
      },
      new Date("2026-09-24T02:00:00.000Z"),
      "outcome-1"
    );
    const source = await readFile(path.join(root, sourcePath));
    const written = JSON.parse(
      await readFile(path.join(root, result.outputPath), "utf8")
    );
    assert.equal(result.outcome.evidence, "human_disposition");
    assert.equal(result.outcome.triageDurationMs, 2 * 60 * 60 * 1000);
    assert.equal(
      result.outcome.sourceReport.sha256,
      createHash("sha256").update(source).digest("hex")
    );
    assert.equal(written.finding.id, target.id);
    await assert.rejects(
      recordFindingOutcome(
        {
          repositoryRoot: root,
          reportPath: sourcePath,
          findingId: target.id,
          findingKind: target.kind,
          status: "accepted",
          actor: "maintainer@example.com",
          reason: "Duplicate event name.",
        },
        new Date("2026-09-24T02:00:00.000Z"),
        "outcome-1"
      ),
      /EEXIST/
    );
  });
});

test("fixed outcome requires a compatible report where the finding is absent", async () => {
  await withFixture(async ({ root, sourcePath, resolutionPath }) => {
    const result = await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        resolutionReportPath: resolutionPath,
        findingId: target.id,
        findingKind: target.kind,
        status: "fixed",
        actor: "developer@example.com",
        reason: "Regression corrected and checks rerun.",
      },
      new Date("2026-09-24T03:00:00.000Z"),
      "outcome-fixed"
    );
    assert.equal(result.outcome.evidence, "finding_absent");
    assert.equal(result.outcome.resolutionReport?.runId, "resolution-run");
  });
});

test("fixed outcome rejects a persistent finding and incompatible context", async () => {
  await withFixture(async ({ root, sourcePath, resolutionPath }) => {
    const resolution = report({
      runId: "persistent-run",
      finishedAt: "2026-09-24T01:00:00.000Z",
      head: "new-head",
      findings: [target],
    });
    await writeFile(path.join(root, resolutionPath), JSON.stringify(resolution), "utf8");
    const options = {
      repositoryRoot: root,
      reportPath: sourcePath,
      resolutionReportPath: resolutionPath,
      findingId: target.id,
      findingKind: target.kind,
      status: "fixed" as const,
      actor: "developer@example.com",
      reason: "Claimed fixed.",
    };
    await assert.rejects(recordFindingOutcome(options), /still present/);

    await writeFile(
      path.join(root, resolutionPath),
      JSON.stringify({ ...resolution, findings: [], configuration: { sha256: SHA_B } }),
      "utf8"
    );
    await assert.rejects(recordFindingOutcome(options), /same configuration/);
  });
});

test("overridden outcome requires retained override evidence", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const common = {
      repositoryRoot: root,
      reportPath: sourcePath,
      findingId: target.id,
      findingKind: target.kind,
      status: "overridden" as const,
      actor: "release-manager@example.com",
      reason: "Accepted exception.",
    };
    await assert.rejects(recordFindingOutcome(common), /retained override evidence/);

    const source = report({
      runId: "overridden-run",
      finishedAt: "2026-09-24T00:00:00.000Z",
      head: "source-head",
      findings: [{
        ...target,
        override: {
          id: "release-exception",
          actor: "release-manager@example.com",
          reason: "Accepted exception.",
          expiresAt: "2026-10-01",
          reportSha256: SHA_A,
        },
      }],
    });
    await writeFile(path.join(root, sourcePath), JSON.stringify(source), "utf8");
    const result = await recordFindingOutcome(
      common,
      new Date("2026-09-24T02:00:00.000Z"),
      "outcome-overridden"
    );
    assert.equal(result.outcome.evidence, "retained_override");
  });
});

test("outcome inputs and outputs must stay inside the repository", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const common = {
      repositoryRoot: root,
      reportPath: sourcePath,
      findingId: target.id,
      findingKind: target.kind,
      status: "rejected" as const,
      actor: "maintainer@example.com",
      reason: "False positive.",
    };
    await assert.rejects(
      recordFindingOutcome({ ...common, reportPath: "../outside.json" }),
      /within the repository/
    );
    await assert.rejects(
      recordFindingOutcome({ ...common, outputDirectory: "../outcomes" }),
      /within the repository/
    );
  });
});

test("outcome metrics aggregate dispositions, blockers, and triage duration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-metrics-"));
  try {
    const directory = path.join(root, ".agentship", "outcomes");
    await mkdir(directory, { recursive: true });
    const event = (
      id: string,
      status: "accepted" | "rejected" | "fixed" | "overridden",
      severity: "blocker" | "warning",
      triageDurationMs: number
    ) => ({
      schemaVersion: 1,
      id,
      status,
      actor: "maintainer@example.com",
      reason: "Calibration fixture.",
      recordedAt: "2026-09-24T02:00:00.000Z",
      triageDurationMs,
      finding: { ...target, id: `finding-${id}`, severity },
      sourceReport: {
        path: `.agentship/reviews/${id}.json`,
        sha256: createHash("sha256").update(id).digest("hex"),
        runId: `run-${id}`,
        finishedAt: "2026-09-24T00:00:00.000Z",
        repository: {
          head: `head-${id}`,
          diffSha256: SHA_B,
          reviewScope: "working-tree",
        },
        configurationSha256: SHA_A,
      },
      ...(status === "fixed"
        ? {
            resolutionReport: {
              path: `.agentship/reviews/${id}-fixed.json`,
              sha256: createHash("sha256").update(`${id}-fixed`).digest("hex"),
              runId: `run-${id}-fixed`,
              finishedAt: "2026-09-24T01:00:00.000Z",
              repository: {
                head: `head-${id}-fixed`,
                diffSha256: SHA_A,
                reviewScope: "working-tree",
              },
              configurationSha256: SHA_A,
            },
          }
        : {}),
      evidence:
        status === "fixed"
          ? "finding_absent"
          : status === "overridden"
            ? "retained_override"
            : "human_disposition",
    });
    const events = [
      event("accepted", "accepted", "blocker", 10),
      event("fixed", "fixed", "warning", 20),
      event("rejected", "rejected", "blocker", 30),
      event("overridden", "overridden", "blocker", 40),
    ];
    await Promise.all(
      events.map((value, index) =>
        writeFile(path.join(directory, `${index}.json`), JSON.stringify(value), "utf8")
      )
    );

    const metrics = await measureFindingOutcomes(root);
    assert.equal(metrics.outcomes, 4);
    assert.deepEqual(metrics.byStatus, {
      accepted: 1,
      rejected: 1,
      fixed: 1,
      overridden: 1,
    });
    assert.equal(metrics.dispositions.precision, 2 / 3);
    assert.equal(metrics.dispositions.coverage, 3 / 4);
    assert.equal(metrics.blockers.falseBlockRate, 1 / 3);
    assert.deepEqual(metrics.triageDurationMs, { median: 20, p90: 40 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("outcome metrics handle empty input and reject duplicate dispositions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-metrics-empty-"));
  try {
    const directory = path.join(root, ".agentship", "outcomes");
    await mkdir(directory, { recursive: true });
    const empty = await measureFindingOutcomes(root);
    assert.equal(empty.dispositions.precision, null);
    assert.equal(empty.blockers.falseBlockRate, null);
    assert.equal(empty.triageDurationMs.median, null);

    const malformedDirectory = path.join(root, ".agentship", "malformed");
    await mkdir(malformedDirectory, { recursive: true });
    await writeFile(
      path.join(malformedDirectory, "invalid.json"),
      JSON.stringify({ schemaVersion: 1, status: "accepted" }),
      "utf8"
    );
    await assert.rejects(
      measureFindingOutcomes(root, ".agentship/malformed"),
      /finding must be an object/
    );

    await withFixture(async ({ root: fixtureRoot, sourcePath }) => {
      const first = await recordFindingOutcome(
        {
          repositoryRoot: fixtureRoot,
          reportPath: sourcePath,
          findingId: target.id,
          findingKind: target.kind,
          status: "accepted",
          actor: "maintainer@example.com",
          reason: "First disposition.",
        },
        new Date("2026-09-24T02:00:00.000Z"),
        "first"
      );
      await writeFile(
        path.join(fixtureRoot, ".agentship", "outcomes", "duplicate.json"),
        JSON.stringify({ ...first.outcome, id: "duplicate" }),
        "utf8"
      );
      await assert.rejects(measureFindingOutcomes(fixtureRoot), /duplicates a source finding/);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("outcome metrics use hash-verified reports for false blocks per 100 reviews", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: target.id,
        findingKind: target.kind,
        status: "rejected",
        actor: "maintainer@example.com",
        reason: "The blocker did not reproduce.",
      },
      new Date("2026-09-24T02:00:00.000Z"),
      "false-block"
    );
    const metrics = await measureFindingOutcomes(
      root,
      ".agentship/outcomes",
      ".agentship/reviews"
    );
    assert.deepEqual(metrics.reviewCorpus, {
      directory: ".agentship/reviews",
      reports: 2,
      reportsWithOutcomes: 1,
      falseBlockedReviews: 1,
      falseBlocksPer100Reviews: 50,
    });

    const incompleteDirectory = path.join(root, ".agentship", "incomplete-reviews");
    await mkdir(incompleteDirectory, { recursive: true });
    await writeFile(
      path.join(incompleteDirectory, "unrelated.json"),
      JSON.stringify(
        report({
          runId: "unrelated",
          finishedAt: "2026-09-24T04:00:00.000Z",
          head: "unrelated-head",
          findings: [],
        })
      ),
      "utf8"
    );
    await assert.rejects(
      measureFindingOutcomes(root, ".agentship/outcomes", ".agentship/incomplete-reviews"),
      /missing 1 source report/
    );
  });
});
