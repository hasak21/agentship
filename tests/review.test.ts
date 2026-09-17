import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFindings,
  calculateVerdict,
  findProtectedRequirementIds,
  renderSarif,
} from "../src/review/review";
import { mapRequirementsToChangedFiles } from "../src/review/requirement-mapper";
import { buildCheckEnvironment, runCheck } from "../src/review/runner";
import type { CheckEvidence, ReviewReport } from "../src/review/types";

function check(overrides: Partial<CheckEvidence> = {}): CheckEvidence {
  return {
    name: "test",
    command: "npm test",
    required: true,
    network: "unspecified",
    environment: [],
    status: "passed",
    exitCode: 0,
    signal: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    ...overrides,
  };
}

function reportWithFindings(
  findings: ReviewReport["findings"]
): ReviewReport {
  return {
    schemaVersion: 1,
    runId: "run-1",
    tool: { name: "AgentShip Verify", version: "0.1.0" },
    mode: "report",
    verdict: findings.some(({ severity }) => severity === "blocker")
      ? "BLOCK"
      : findings.length
      ? "WARN"
      : "PASS",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    repository: {
      root: "/repo",
      head: "head",
      postCheckHead: "head",
      reviewScope: "working-tree",
      diffSha256: "diff-hash",
      postCheckDiffSha256: "diff-hash",
      stableDuringChecks: true,
      changedFiles: [],
    },
    configuration: { path: ".agentship.yml", sha256: "config-hash" },
    checks: [],
    findings,
    summary: { passed: 0, failed: 0, timedOut: 0 },
  };
}

test("required failed checks produce a blocking verdict", () => {
  const findings = buildFindings([check({ status: "failed", exitCode: 1 })]);
  assert.equal(findings[0]?.kind, "required_check_failed");
  assert.equal(calculateVerdict(findings), "BLOCK");
});

test("optional failed checks produce a warning verdict", () => {
  const findings = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ]);
  assert.equal(findings[0]?.kind, "optional_check_failed");
  assert.equal(calculateVerdict(findings), "WARN");
});

test("all passing checks produce a pass verdict", () => {
  const findings = buildFindings([check()]);
  assert.deepEqual(findings, []);
  assert.equal(calculateVerdict(findings), "PASS");
});

test("repository mutation during checks produces a blocker", () => {
  const findings = buildFindings([check()], {
    stable: false,
    beforeHead: "before-head",
    afterHead: "after-head",
    beforeDiffSha256: "before-diff",
    afterDiffSha256: "after-diff",
  });

  assert.equal(findings[0]?.kind, "repository_changed_during_review");
  assert.equal(calculateVerdict(findings), "BLOCK");
  assert.equal(findings[0]?.evidence.afterDiffSha256, "after-diff");
});

test("requirements marked for confirmation block until confirmed", () => {
  const pending = buildFindings(
    [check()],
    undefined,
    [],
    [{ id: "R1", confirmation: "required" }]
  );
  assert.equal(pending[0]?.kind, "requirement_confirmation_missing");
  assert.equal(calculateVerdict(pending), "BLOCK");

  const confirmed = buildFindings(
    [check()],
    undefined,
    [],
    [{ id: "R1", confirmation: "confirmed" }]
  );
  assert.deepEqual(confirmed, []);
  assert.equal(calculateVerdict(confirmed), "PASS");
});

test("missing-path findings identify only unmatched requirement references", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R1",
        status: "missing",
        references: ["src/auth/session.ts", "tests/auth/session.test.ts"],
        missingReferences: ["tests/auth/session.test.ts"],
        checkEvidence: [],
        symbolEvidence: [],
        missingRoles: [],
      },
    ]
  );

  assert.deepEqual(findings[0]?.evidence.expectedPaths, [
    "tests/auth/session.test.ts",
  ]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("unsatisfied check annotations produce evidence-backed warnings", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R2",
        status: "missing",
        references: [],
        missingReferences: [],
        checkEvidence: [{ name: "integration", status: "not_configured" }],
        symbolEvidence: [],
        missingRoles: [],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "explicit_requirement_evidence_unsatisfied");
  assert.deepEqual(findings[0]?.evidence.expectedChecks, [
    { name: "integration", status: "not_configured" },
  ]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("inferred missing roles produce non-blocking, explicitly inferred warnings", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R3",
        status: "inferred_missing",
        references: [],
        missingReferences: [],
        checkEvidence: [],
        symbolEvidence: [],
        missingRoles: ["documentation"],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "inferred_requirement_role_missing");
  assert.deepEqual(findings[0]?.evidence.expectedRoles, ["documentation"]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("unsatisfied symbol annotations retain path, symbol, and diff status", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R4",
        status: "missing",
        references: [],
        missingReferences: [],
        checkEvidence: [],
        symbolEvidence: [
          {
            path: "src/auth/session.ts",
            symbol: "rotateKey",
            status: "symbol_not_in_diff",
          },
        ],
        missingRoles: [],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "explicit_requirement_evidence_unsatisfied");
  assert.deepEqual(findings[0]?.evidence.expectedSymbols, [
    {
      path: "src/auth/session.ts",
      symbol: "rotateKey",
      status: "symbol_not_in_diff",
    },
  ]);
});

test("strict change coverage warns about unattributed files only when enabled", () => {
  const advisory = buildFindings(
    [check()],
    undefined,
    [],
    [],
    { strict: false, unattributedFiles: ["src/unexpected.ts"] }
  );
  assert.deepEqual(advisory, []);

  const strict = buildFindings(
    [check()],
    undefined,
    [],
    [],
    { strict: true, unattributedFiles: ["src/unexpected.ts"] }
  );
  assert.equal(strict[0]?.kind, "unattributed_changes");
  assert.deepEqual(strict[0]?.evidence.unexpectedPaths, ["src/unexpected.ts"]);
  assert.equal(calculateVerdict(strict), "WARN");
});

test("SARIF maps findings to rules, levels, and safe repository-relative locations", () => {
  const sarif = renderSarif(
    reportWithFindings([
      {
        id: "check-1",
        severity: "blocker",
        kind: "required_check_failed",
        title: "Required test failed",
        evidence: { check: "test" },
      },
      {
        id: "requirement-R1",
        severity: "warning",
        kind: "explicit_requirement_path_unchanged",
        title: "R1 path is unchanged",
        evidence: { expectedPaths: ["src/auth session.ts"] },
      },
      {
        id: "requirement-R2",
        severity: "warning",
        kind: "explicit_requirement_path_unchanged",
        title: "R2 path is unchanged",
        evidence: { expectedPaths: ["../outside.ts"] },
      },
    ])
  );

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0]?.tool.driver.rules.length, 2);
  assert.equal(sarif.runs[0]?.results[0]?.level, "error");
  assert.equal(sarif.runs[0]?.results[1]?.level, "warning");
  assert.equal(
    sarif.runs[0]?.results[1]?.locations?.[0]?.physicalLocation.artifactLocation.uri,
    "src/auth%20session.ts"
  );
  assert.equal("locations" in (sarif.runs[0]?.results[2] ?? {}), false);
  assert.deepEqual(sarif.runs[0]?.invocations[0]?.properties, {
    runId: "run-1",
    verdict: "BLOCK",
    diffSha256: "diff-hash",
  });
});

test("protected path policies select requirements with observed file or symbol evidence", () => {
  const diff = `diff --git a/src/payments/charge.ts b/src/payments/charge.ts
--- a/src/payments/charge.ts
+++ b/src/payments/charge.ts
@@ -1 +1 @@
-charge();
+authorizeCharge();`;
  const mappings = mapRequirementsToChangedFiles(
    [
      {
        id: "R1",
        text: "Update `change:src/payments/charge.ts`.",
        line: 1,
        confirmation: "not_required",
        confirmationBasis: [],
      },
      {
        id: "R2",
        text: "Change `symbol:src/payments/charge.ts#authorizeCharge`.",
        line: 2,
        confirmation: "not_required",
        confirmationBasis: [],
      },
      {
        id: "R3",
        text: "Update `change:src/profile.ts`.",
        line: 3,
        confirmation: "not_required",
        confirmationBasis: [],
      },
    ],
    ["src/payments/charge.ts", "src/profile.ts"],
    [],
    diff
  );

  assert.deepEqual(
    findProtectedRequirementIds(mappings, [
      { pattern: "src/payments/**", requireManualApproval: true },
      { pattern: "src/profile.ts", requireManualApproval: false },
    ]),
    ["R1", "R2"]
  );
});

test("check environments are allowlisted and secrets are redacted", async () => {
  const previousSecret = process.env.AGENTSHIP_TEST_SECRET;
  const previousIgnored = process.env.AGENTSHIP_TEST_IGNORED;
  process.env.AGENTSHIP_TEST_SECRET = "should-not-appear";
  process.env.AGENTSHIP_TEST_IGNORED = "not-allowed";

  try {
    const environment = buildCheckEnvironment({
      name: "environment",
      run: "ignored",
      environment: ["AGENTSHIP_TEST_SECRET"],
    });
    assert.equal(environment.AGENTSHIP_TEST_SECRET, "should-not-appear");
    assert.equal(environment.AGENTSHIP_TEST_IGNORED, undefined);

    const evidence = await runCheck(
      {
        name: "redaction",
        run: `node -e "process.stdout.write(process.env.AGENTSHIP_TEST_SECRET)"`,
        environment: ["AGENTSHIP_TEST_SECRET"],
      },
      process.cwd()
    );
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.stdout, "[REDACTED:AGENTSHIP_TEST_SECRET]");
    assert.ok(evidence.environment.includes("AGENTSHIP_TEST_SECRET"));
  } finally {
    if (previousSecret === undefined) delete process.env.AGENTSHIP_TEST_SECRET;
    else process.env.AGENTSHIP_TEST_SECRET = previousSecret;
    if (previousIgnored === undefined) delete process.env.AGENTSHIP_TEST_IGNORED;
    else process.env.AGENTSHIP_TEST_IGNORED = previousIgnored;
  }
});

test("timed-out checks terminate and record timeout evidence", async () => {
  const evidence = await runCheck(
    {
      name: "timeout",
      run: `node -e "setInterval(() => {}, 1000)"`,
      timeoutSeconds: 0.05,
    },
    process.cwd()
  );

  assert.equal(evidence.status, "timed_out");
  assert.ok(evidence.durationMs < 2_000);
});
