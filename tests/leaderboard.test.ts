import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileLeaderboard } from "../src/review/leaderboard";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const taskSha = digest("task-one");
const suiteSha = digest("suite-one");

function report(verdict: "PASS" | "WARN" | "BLOCK", blockers = 0) {
  return {
    schemaVersion: 1,
    verdict,
    task: { sha256: taskSha },
    configuration: { sha256: digest("review-policy") },
    repository: { reviewScope: "base" as "working-tree" | "staged" | "base", base: "baseline" as string | undefined, baseCommit: "a".repeat(40) as string | undefined },
    checks: [{ name: "test", command: "node --test", status: "passed", exitCode: 0, signal: null,
      ...(verdict === "PASS" ? { causal: {
        expectation: "fails_on_base", baseCommit: "a".repeat(40), testPaths: ["tests/test.ts"], overlaidFiles: ["tests/test.ts"],
        satisfied: true, reason: "normal_nonzero_exit",
        base: { name: "test", command: "node --test", status: "failed", exitCode: 1, signal: null },
      } } : {}),
    }],
    findings: Array.from({ length: verdict === "WARN" ? 1 : blockers }, (_, index) => ({
      id: `block-${index}`,
      kind: "required_check_failed",
      severity: verdict === "WARN" ? "warning" : "blocker",
      title: "blocked",
      evidence: {},
    })),
  };
}

async function addSubmission(root: string, id: string, value: unknown) {
  const reportName = `reports/${id}.json`;
  const source = `${JSON.stringify(value)}\n`;
  await mkdir(path.join(root, "reports"), { recursive: true });
  await writeFile(path.join(root, reportName), source);
  const manifest = {
    schemaVersion: 1,
    type: "agentship.agent-evaluation",
    submissionId: id,
    agent: { name: id, model: `${id}-model` },
    suite: { id: "suite-one", sha256: suiteSha },
    tasks: [{ id: "task-one", taskSha256: taskSha, report: reportName, reportSha256: digest(source) }],
  };
  await writeFile(path.join(root, `${id}.submission.json`), `${JSON.stringify(manifest)}\n`);
}

test("leaderboard ranks comparable hash-bound AgentShip reports deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-leaderboard-"));
  try {
    await addSubmission(root, "agent-block", report("BLOCK", 1));
    await addSubmission(root, "agent-pass", report("PASS"));
    const result = await compileLeaderboard(root);
    assert.deepEqual(result.suite.tasks, ["task-one"]);
    assert.deepEqual(result.suite.reviewContexts, [{ taskId: "task-one", configurationSha256: digest("review-policy"), reviewScope: "base", base: "baseline", baseCommit: "a".repeat(40) }]);
    assert.deepEqual(result.submissions.map(({ submissionId }) => submissionId), ["agent-pass", "agent-block"]);
    assert.equal(result.submissions[0]?.metrics.passRate, 1);
    assert.equal(result.submissions[0]?.metrics.causalReproductions, 1);
    assert.equal(result.submissions[1]?.metrics.activeBlockers, 1);
    assert.match(result.limitations[0] ?? "", /not report signer or runner authenticity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leaderboard refuses contradictory verdicts and inflated causal claims despite correct hashes", async () => {
  const mutations = [
    (value: Record<string, unknown>) => { value.findings = [{ id: "block", kind: "required_check_failed", severity: "blocker" }]; },
    (value: Record<string, unknown>) => { value.findings = [null]; },
    (value: Record<string, unknown>) => { value.findings = [{ id: "block", kind: "required_check_failed", severity: "blocker", override: "approved" }]; },
    (value: Record<string, unknown>) => { value.checks = [{ name: "test", status: "passed", exitCode: 0, signal: null, causal: { satisfied: "true" } }]; },
    (value: Record<string, unknown>) => { const check = (value.checks as Array<Record<string, unknown>>)[0]; (check.causal as { base: { exitCode: number } }).base.exitCode = 127; },
    (value: Record<string, unknown>) => { const check = (value.checks as Array<Record<string, unknown>>)[0]; check.status = "failed"; check.exitCode = 1; },
    (value: Record<string, unknown>) => { const checks = value.checks as unknown[]; checks.push(structuredClone(checks[0])); },
    (value: Record<string, unknown>) => { const check = (value.checks as Array<Record<string, unknown>>)[0]; check.execution = { cleanupFailed: true }; },
    (value: Record<string, unknown>) => { value.findings = [{ id: "block", kind: "required_check_failed", severity: ["blocker"] }]; },
    (value: Record<string, unknown>) => { value.findings = [{ id: "block", kind: "required_check_failed", severity: "blocker", override: {} }]; },
    (value: Record<string, unknown>) => { const check = (value.checks as Array<Record<string, unknown>>)[0]; const causal = check.causal as { base: { execution?: unknown } }; causal.base.execution = { writableStorage: { exceeded: false, accountingFailed: true } }; },
    (value: Record<string, unknown>) => { const check = (value.checks as Array<Record<string, unknown>>)[0]; const causal = check.causal as { base: { execution?: unknown } }; causal.base.execution = { backend: "not_executed" }; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentship-rank-consistency-"));
    try {
      const value = report("PASS");
      mutate(value);
      await addSubmission(root, "agent", value);
      await assert.rejects(compileLeaderboard(root), /invalid|inconsistent|duplicate|contradict/i, `mutation ${index}`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("leaderboard permits structured inactive findings and consistent failed causal reproduction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-dispositions-"));
  try {
    for (const key of ["suppression", "override"] as const) {
      const value = report("PASS");
      value.findings = [{ ...report("BLOCK", 1).findings[0], [key]: {
        id: "exception", owner: "owner", actor: "actor", reason: "Historical exception", expiresAt: "2026-12-31", reportSha256: "a".repeat(64),
      } }];
      await addSubmission(root, key, value);
    }
    const failed = report("PASS");
    failed.verdict = "BLOCK";
    failed.findings = report("BLOCK", 1).findings;
    const causal = failed.checks[0].causal!;
    causal.satisfied = false;
    causal.base.status = "passed";
    causal.base.exitCode = 0;
    causal.reason = "base_not_failed";
    await addSubmission(root, "not-reproduced", failed);
    const result = await compileLeaderboard(root);
    assert.deepEqual(result.submissions.map(row => row.metrics.activeBlockers), [0, 0, 1]);
    assert.equal(result.submissions.at(-1)?.metrics.causalReproductions, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("leaderboard requires string manifest identities and digests rather than regex coercion", async () => {
  for (const field of ["submissionId", "suiteSha", "taskSha"] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-types-"));
    try {
      await addSubmission(root, "agent", report("PASS"));
      const filename = path.join(root, "agent.submission.json");
      const manifest = JSON.parse(await readFile(filename, "utf8"));
      if (field === "submissionId") manifest.submissionId = [manifest.submissionId];
      if (field === "suiteSha") manifest.suite.sha256 = [manifest.suite.sha256];
      if (field === "taskSha") manifest.tasks[0].taskSha256 = [manifest.tasks[0].taskSha256];
      await writeFile(filename, JSON.stringify(manifest));
      await assert.rejects(compileLeaderboard(root), /invalid/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("leaderboard refuses non-regular manifest entries rather than silently omitting a candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-file-types-"));
  try {
    await addSubmission(root, "agent", report("PASS"));
    await mkdir(path.join(root, "omitted.submission.json"));
    await assert.rejects(compileLeaderboard(root), /invalid file type/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("leaderboard rejects report tampering and incomparable suites", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-leaderboard-invalid-"));
  try {
    await addSubmission(root, "agent-one", report("PASS"));
    await writeFile(path.join(root, "reports", "agent-one.json"), "{}\n");
    await assert.rejects(compileLeaderboard(root), /report SHA-256 does not match/);

    await rm(root, { recursive: true, force: true });
    await mkdir(root);
    await addSubmission(root, "agent-one", report("PASS"));
    await addSubmission(root, "agent-two", report("PASS"));
    const second = path.join(root, "agent-two.submission.json");
    const manifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(second, "utf8")));
    manifest.suite.id = "another-suite";
    await writeFile(second, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(compileLeaderboard(root), /same suite ID and SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leaderboard rejects incomparable review policy, scope or base for the same task", async () => {
  for (const field of ["policy", "scope", "base", "commit"] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-context-"));
    try {
      await addSubmission(root, "agent-one", report("PASS"));
      const other = report("PASS");
      if (field === "policy") other.configuration.sha256 = digest("weaker-policy");
      if (field === "scope") { other.repository.reviewScope = "staged"; other.repository.base = undefined; other.repository.baseCommit = undefined; other.checks = []; }
      if (field === "base") other.repository.base = "different-baseline";
      if (field === "commit") { other.repository.baseCommit = "b".repeat(40); other.checks[0].causal!.baseCommit = "b".repeat(40); }
      await addSubmission(root, "agent-two", other);
      await assert.rejects(compileLeaderboard(root), /same review policy and scope/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("leaderboard compares review contexts per task regardless of manifest task order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-multi-context-"));
  try {
    for (const id of ["agent-one", "agent-two"]) {
      await addSubmission(root, id, report("PASS"));
      const filename = path.join(root, `${id}.submission.json`);
      const manifest = JSON.parse(await readFile(filename, "utf8"));
      const second = report("PASS");
      second.task.sha256 = digest("task-two");
      second.configuration.sha256 = digest("task-two-policy");
      second.repository.base = "task-two-baseline";
      const bytes = JSON.stringify(second);
      const reportPath = `reports/${id}-two.json`;
      await writeFile(path.join(root, reportPath), bytes);
      manifest.tasks.push({ id: "task-two", taskSha256: second.task.sha256, report: reportPath, reportSha256: digest(bytes) });
      if (id === "agent-two") manifest.tasks.reverse();
      await writeFile(filename, JSON.stringify(manifest));
    }
    const result = await compileLeaderboard(root);
    assert.deepEqual(result.suite.reviewContexts.map(row => [row.taskId, row.configurationSha256, row.base]), [
      ["task-one", digest("review-policy"), "baseline"], ["task-two", digest("task-two-policy"), "task-two-baseline"],
    ]);
    assert.ok(result.submissions.every(row => row.metrics.tasks === 2));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("leaderboard requires explicit valid policy and scope evidence instead of wildcard defaults", async () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { delete value.configuration; },
    (value: Record<string, unknown>) => { delete value.repository; },
    (value: Record<string, unknown>) => { value.configuration = { sha256: [digest("review-policy")] }; },
    (value: Record<string, unknown>) => { value.repository = { reviewScope: "base" }; },
    (value: Record<string, unknown>) => { value.repository = { reviewScope: "staged", base: "not-applicable" }; },
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentship-ranking-missing-context-"));
    try {
      const value = report("PASS");
      mutate(value);
      await addSubmission(root, "agent", value);
      await assert.rejects(compileLeaderboard(root), /invalid/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("leaderboard bounds aggregate evidence even when individually valid tasks reuse a report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-leaderboard-budget-"));
  try {
    await addSubmission(root, "agent", { ...report("PASS"), padding: "x".repeat(2 * 1024 * 1024) } as ReturnType<typeof report>);
    const filename = path.join(root, "agent.submission.json");
    const manifest = JSON.parse(await readFile(filename, "utf8"));
    const task = manifest.tasks[0];
    manifest.tasks = Array.from({ length: 33 }, (_, index) => ({ ...task, id: `task-${index}` }));
    await writeFile(filename, JSON.stringify(manifest));
    await assert.rejects(compileLeaderboard(root), /Leaderboard evidence exceeds.*aggregate byte budget/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("leaderboard rejects invalid UTF-8 manifest identity instead of replacement decoding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-leaderboard-encoding-"));
  try {
    await addSubmission(root, "agent", report("PASS"));
    const filename = path.join(root, "agent.submission.json");
    const source = await readFile(filename, "utf8");
    const marker = '"model":"';
    const position = source.indexOf(marker) + marker.length;
    assert.ok(position >= marker.length);
    await writeFile(filename, Buffer.concat([Buffer.from(source.slice(0, position)), Buffer.from([0xff]), Buffer.from(source.slice(position))]));
    await assert.rejects(compileLeaderboard(root), /Leaderboard evidence.*must contain valid UTF-8/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("incremental leaderboard aggregation retains mixed verdict metrics and rejects malformed report bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-leaderboard-incremental-"));
  try {
    await addSubmission(root, "agent", report("PASS"));
    const filename = path.join(root, "agent.submission.json");
    const manifest = JSON.parse(await readFile(filename, "utf8"));
    const template = manifest.tasks[0];
    manifest.tasks = [];
    for (const [index, verdict] of (["PASS", "WARN", "BLOCK"] as const).entries()) {
      const reportName = `reports/mixed-${index}.json`;
      const source = JSON.stringify(report(verdict, verdict === "BLOCK" ? 2 : 0));
      await writeFile(path.join(root, reportName), source);
      manifest.tasks.push({ ...template, id: `task-${index}`, report: reportName, reportSha256: digest(source) });
    }
    await writeFile(filename, JSON.stringify(manifest));
    const result = await compileLeaderboard(root);
    assert.deepEqual(result.submissions[0].metrics, {
      tasks: 3, pass: 1, warn: 1, block: 1, passRate: 1 / 3, activeBlockers: 2, causalReproductions: 1,
    });
    // Bind the malformed bytes correctly so rejection cannot be attributed to a digest mismatch.
    const invalid = Buffer.concat([Buffer.from('{"extra":"'), Buffer.from([0xff]), Buffer.from(`",${JSON.stringify(report("PASS")).slice(1)}`)]);
    await writeFile(path.join(root, manifest.tasks[0].report), invalid);
    manifest.tasks[0].reportSha256 = digest(invalid);
    await writeFile(filename, JSON.stringify(manifest));
    await assert.rejects(compileLeaderboard(root), /Leaderboard evidence.*must contain valid UTF-8/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
