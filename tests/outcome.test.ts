import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordFindingOutcome } from "../src/review/outcome";

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
