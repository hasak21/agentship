import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    checks: [{ causal: { satisfied: verdict === "PASS" } }],
    findings: Array.from({ length: blockers }, (_, index) => ({
      id: `block-${index}`,
      kind: "required_check_failed",
      severity: "blocker",
      title: "blocked",
      evidence: {},
    })),
  };
}

async function addSubmission(root: string, id: string, value: ReturnType<typeof report>) {
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
    assert.deepEqual(result.submissions.map(({ submissionId }) => submissionId), ["agent-pass", "agent-block"]);
    assert.equal(result.submissions[0]?.metrics.passRate, 1);
    assert.equal(result.submissions[0]?.metrics.causalReproductions, 1);
    assert.equal(result.submissions[1]?.metrics.activeBlockers, 1);
    assert.match(result.limitations[0] ?? "", /not report signer or runner authenticity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
