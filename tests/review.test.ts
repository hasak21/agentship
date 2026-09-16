import test from "node:test";
import assert from "node:assert/strict";
import { buildFindings, calculateVerdict } from "../src/review/review";
import { buildCheckEnvironment, runCheck } from "../src/review/runner";
import type { CheckEvidence } from "../src/review/types";

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
