import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  measureFindingOutcomes,
  recordFindingOutcome,
  recordMissedFinding,
  recordMissedFindingAudit,
} from "../src/review/outcome";

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

test("outcome metrics reject invalid UTF-8 dispositions instead of altering actor identity", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const result = await recordFindingOutcome({
      repositoryRoot: root, reportPath: sourcePath, findingId: target.id, findingKind: target.kind,
      status: "accepted", actor: "\ufffd", reason: "Reproduced locally.",
    }, new Date("2026-09-24T02:00:00.000Z"), "encoding-event");
    assert.equal((await measureFindingOutcomes(root)).outcomes, 1);
    const filename = path.join(root, result.outputPath);
    const source = await readFile(filename);
    const position = source.indexOf(Buffer.from("\ufffd"));
    await writeFile(filename, Buffer.concat([source.subarray(0, position), Buffer.from([0xff]), source.subarray(position + 3)]));
    await assert.rejects(measureFindingOutcomes(root), /Outcome file.*must contain valid UTF-8/);
  });
});

test("metrics refuse non-regular JSON entries rather than silently reducing sample counts", async () => {
  await withFixture(async ({ root }) => {
    const outcomes = ".agentship/outcomes";
    const missed = ".agentship/missed-findings";
    await mkdir(path.join(root, outcomes), { recursive: true });
    await mkdir(path.join(root, missed), { recursive: true });
    for (const [directory, expected] of [
      [outcomes, /Outcome file.*must be a regular file/],
      [".agentship/reviews", /Review corpus file.*must be a regular file/],
      [missed, /Missed-finding file.*must be a regular file/],
    ] as const) {
      const invalid = path.join(root, directory, "hidden.json");
      await mkdir(invalid);
      await assert.rejects(measureFindingOutcomes(root, outcomes, ".agentship/reviews", missed), expected);
      await rm(invalid, { recursive: true });
    }
  });
});

test("outcome metrics share a budget across corpus and repeated missed-label corpus reads", async () => {
  await withFixture(async ({ root }) => {
    const outcomes = ".agentship/outcomes";
    const missed = ".agentship/missed-findings";
    await mkdir(path.join(root, outcomes), { recursive: true });
    await mkdir(path.join(root, missed), { recursive: true });
    const padding = "x".repeat(2 * 1024 * 1024);
    for (let index = 0; index < 17; index++) {
      await writeFile(path.join(root, ".agentship/reviews", `bulk-${index}.json`), JSON.stringify({
        ...report({ runId: `bulk-${index}`, finishedAt: "2026-09-24T00:00:00.000Z", head: "head", findings: [] }), padding,
      }));
    }
    for (let index = 0; index < 17; index++) {
      await recordMissedFinding(
        {
          repositoryRoot: root,
          reportPath: ".agentship/reviews/bulk-0.json",
          findingId: `missed-${index}`,
          findingKind: "missing_test",
          severity: "warning",
          title: `Missed test ${index}`,
          actor: "auditor@example.com",
          reason: "Aggregate read budget fixture.",
        },
        new Date("2026-09-24T01:00:00.000Z"),
        `budget-label-${index}`
      );
    }
    assert.ok((await measureFindingOutcomes(root, outcomes, ".agentship/reviews")).reviewCorpus);
    await assert.rejects(measureFindingOutcomes(root, outcomes, ".agentship/reviews", missed), /Outcome metrics evidence exceeds 67108864 aggregate byte budget/);
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

test("audit event rejection does not create directories outside the repository through a link", async (context) => {
  if (process.platform === "win32") return context.skip("requires symlink creation");
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentship-event-outside-"));
  try {
    await withFixture(async ({ root, sourcePath }) => {
      await symlink(outside, path.join(root, "redirect"));
      const common = { repositoryRoot: root, reportPath: sourcePath, actor: "maintainer", reason: "Audited locally." };
      await assert.rejects(recordFindingOutcome({
        ...common, findingId: target.id, findingKind: target.kind, status: "accepted", outputDirectory: "redirect/new-outcome",
      }, new Date("2026-09-24T02:00:00.000Z"), "outcome-link"));
      assert.deepEqual(await readdir(outside), [], "refusal must precede external directory creation");
      await assert.rejects(recordMissedFinding({
        ...common, findingId: "missing", findingKind: "missing_security_validation", severity: "blocker", title: "Missing validation", outputDirectory: "redirect/new-missed",
      }, new Date("2026-09-24T02:00:00.000Z"), "missed-link"));
      assert.deepEqual(await readdir(outside), []);
    });
  } finally { await rm(outside, { recursive: true, force: true }); }
});

test("audit event destinations exclude Git administration paths", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const common = { repositoryRoot: root, reportPath: sourcePath, actor: "maintainer", reason: "Audited locally.", outputDirectory: ".git/events" };
    await assert.rejects(recordFindingOutcome({ ...common, findingId: target.id, findingKind: target.kind, status: "accepted" }), /outside .git/);
    await assert.rejects(recordMissedFinding({ ...common, findingId: "missing", findingKind: "missing_security_validation", severity: "blocker", title: "Missing validation" }), /outside .git/);
  });
});

test("missed-finding labels bind a report and require an absent finding", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    const result = await recordMissedFinding(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: "missed-security-check",
        findingKind: "missing_security_validation",
        severity: "blocker",
        title: "Security validation was omitted",
        actor: "maintainer@example.com",
        reason: "Confirmed by an independent patch audit.",
      },
      new Date("2026-09-24T02:00:00.000Z"),
      "missed-1"
    );
    assert.equal(result.label.evidence, "human_missed_finding_label");
    assert.match(result.outputPath, /^\.agentship\/missed-findings\//);
    await assert.rejects(
      recordMissedFinding({
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: target.id,
        findingKind: target.kind,
        severity: "blocker",
        title: target.title,
        actor: "maintainer@example.com",
        reason: "This was actually emitted.",
      }),
      /already present/
    );
  });
});

test("outcome metrics report recall only with corpus-bound missed labels", async () => {
  await withFixture(async ({ root, sourcePath }) => {
    await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: target.id,
        findingKind: target.kind,
        status: "accepted",
        actor: "maintainer@example.com",
        reason: "Valid finding.",
      },
      new Date("2026-09-24T02:00:00.000Z"),
      "valid-1"
    );
    const missed = await recordMissedFinding(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: "missed-1",
        findingKind: "missing_test",
        severity: "warning",
        title: "A required test was missed",
        actor: "auditor@example.com",
        reason: "Independent audit label.",
      },
      new Date("2026-09-24T03:00:00.000Z"),
      "recall-label"
    );
    await assert.rejects(
      recordMissedFindingAudit(
        {
          repositoryRoot: root,
          reportPath: sourcePath,
          actor: "auditor@example.com",
          reason: "Premature completion claim.",
        },
        new Date("2026-09-24T02:30:00.000Z"),
        "premature-audit"
      ),
      /after its report and labels/
    );
    const audit = await recordMissedFindingAudit(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        actor: "auditor@example.com",
        reason: "Completed review of all source-report omissions.",
      },
      new Date("2026-09-24T04:00:00.000Z"),
      "audit-1"
    );
    assert.equal(audit.audit.labelCount, 1);
    await assert.rejects(
      measureFindingOutcomes(root, ".agentship/outcomes", undefined, ".agentship/missed-findings", ".agentship/missed-audits"),
      /require --reports/
    );
    const labelsOnly = await measureFindingOutcomes(
      root, ".agentship/outcomes", ".agentship/reviews", ".agentship/missed-findings"
    );
    assert.equal(labelsOnly.recall, undefined);
    const metrics = await measureFindingOutcomes(
      root,
      ".agentship/outcomes",
      ".agentship/reviews",
      ".agentship/missed-findings",
      ".agentship/missed-audits"
    );
    assert.deepEqual(metrics.recall, {
      labelsDirectory: ".agentship/missed-findings",
      auditsDirectory: ".agentship/missed-audits",
      auditedReports: 1,
      corpusReports: 2,
      auditCoverage: 0.5,
      validEmittedFindings: 1,
      missedFindings: 1,
      recall: 0.5,
    });
    await writeFile(
      path.join(root, ".agentship", "missed-findings", "duplicate.json"),
      await readFile(path.join(root, missed.outputPath), "utf8"),
      "utf8"
    );
    await assert.rejects(
      measureFindingOutcomes(
        root,
        ".agentship/outcomes",
        ".agentship/reviews",
        ".agentship/missed-findings",
        ".agentship/missed-audits"
      ),
      /duplicates a label/
    );
  });
});

test("completed missed-finding audits bind zero-label reviews and reject changed label sets", async () => {
  await withFixture(async ({ root, sourcePath, resolutionPath }) => {
    await mkdir(path.join(root, ".agentship", "outcomes"), { recursive: true });
    await recordMissedFindingAudit(
      {
        repositoryRoot: root,
        reportPath: resolutionPath,
        actor: "auditor@example.com",
        reason: "Reviewed all requirements and found no omissions.",
      },
      new Date("2026-09-24T03:00:00.000Z"),
      "zero-label-audit"
    );
    const empty = await measureFindingOutcomes(
      root, ".agentship/outcomes", ".agentship/reviews",
      ".agentship/missed-findings", ".agentship/missed-audits"
    );
    assert.equal(empty.recall?.auditedReports, 1);
    assert.equal(empty.recall?.recall, null);

    await recordMissedFinding(
      {
        repositoryRoot: root,
        reportPath: resolutionPath,
        findingId: "late-omission",
        findingKind: "missing_test",
        severity: "warning",
        title: "Late omission",
        actor: "auditor@example.com",
        reason: "Found after the completed audit.",
      },
      new Date("2026-09-24T04:00:00.000Z"),
      "late-label"
    );
    await assert.rejects(
      measureFindingOutcomes(
        root, ".agentship/outcomes", ".agentship/reviews",
        ".agentship/missed-findings", ".agentship/missed-audits"
      ),
      /label set has changed/
    );

    await assert.rejects(
      recordMissedFindingAudit({
        repositoryRoot: root,
        reportPath: sourcePath,
        actor: "auditor@example.com",
        reason: "Unsafe path.",
        outputDirectory: "../audits",
      }),
      /within the repository/
    );
  });
});

test("recall includes only audited reports and rejects labels without audits", async () => {
  await withFixture(async ({ root, sourcePath, resolutionPath }) => {
    await recordFindingOutcome(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        findingId: target.id,
        findingKind: target.kind,
        status: "accepted",
        actor: "maintainer@example.com",
        reason: "Confirmed finding.",
      },
      new Date("2026-09-24T02:00:00.000Z"),
      "accepted-for-audit"
    );
    await recordMissedFinding(
      {
        repositoryRoot: root,
        reportPath: resolutionPath,
        findingId: "missed-requirement",
        findingKind: "missing_test",
        severity: "warning",
        title: "Missed requirement",
        actor: "auditor@example.com",
        reason: "Independent audit finding.",
      },
      new Date("2026-09-24T03:00:00.000Z"),
      "scoped-label"
    );
    await mkdir(path.join(root, ".agentship", "missed-audits"), { recursive: true });
    const measure = () => measureFindingOutcomes(
      root, ".agentship/outcomes", ".agentship/reviews",
      ".agentship/missed-findings", ".agentship/missed-audits"
    );
    await assert.rejects(measure(), /completed audit for every labeled report/);
    await recordMissedFindingAudit(
      {
        repositoryRoot: root,
        reportPath: resolutionPath,
        actor: "auditor@example.com",
        reason: "Completed audit of resolution report.",
      },
      new Date("2026-09-24T04:00:00.000Z"),
      "resolution-audit"
    );
    const scoped = await measure();
    assert.equal(scoped.recall?.validEmittedFindings, 0);
    assert.equal(scoped.recall?.recall, 0);
    assert.equal(scoped.recall?.auditCoverage, 0.5);
    await recordMissedFindingAudit(
      {
        repositoryRoot: root,
        reportPath: sourcePath,
        actor: "auditor@example.com",
        reason: "Completed audit of source report.",
      },
      new Date("2026-09-24T05:00:00.000Z"),
      "source-audit"
    );
    const complete = await measure();
    assert.equal(complete.recall?.validEmittedFindings, 1);
    assert.equal(complete.recall?.recall, 0.5);
    assert.equal(complete.recall?.auditCoverage, 1);
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
