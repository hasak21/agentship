import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { applyOverride, loadOverride } from "../src/review/override";
import { calculateVerdict, runReview } from "../src/review/review";
import type { ReviewFinding } from "../src/review/types";

const finding: ReviewFinding = {
  id: "check-1",
  kind: "required_check_failed",
  severity: "blocker",
  title: "Required check failed",
  evidence: { check: "integration" },
};
const execFileAsync = promisify(execFile);

async function withOverrideFixture(
  run: (fixture: {
    root: string;
    overridePath: string;
    binding: {
      head: string;
      diffSha256: string;
      configurationSha256: string;
      taskSha256: string;
    };
    override: Record<string, unknown>;
  }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-override-"));
  try {
    await mkdir(path.join(root, ".agentship", "reviews"), { recursive: true });
    const binding = {
      head: "head-1",
      diffSha256: "d".repeat(64),
      configurationSha256: "c".repeat(64),
      taskSha256: "t".repeat(64),
    };
    const report = {
      schemaVersion: 1,
      runId: "run-1",
      repository: { head: binding.head, diffSha256: binding.diffSha256 },
      configuration: { sha256: binding.configurationSha256 },
      task: { sha256: binding.taskSha256 },
      findings: [finding],
    };
    const reportSource = `${JSON.stringify(report)}\n`;
    const reportPath = ".agentship/reviews/source.json";
    await writeFile(path.join(root, reportPath), reportSource, "utf8");
    const override = {
      schemaVersion: 1,
      id: "release-exception-1",
      actor: "release-manager@example.com",
      reason: "Known upstream outage; rollback owner is on call.",
      expiresAt: "2026-10-01",
      report: {
        path: reportPath,
        sha256: createHash("sha256").update(reportSource).digest("hex"),
      },
      findings: [{ id: finding.id, kind: finding.kind }],
    };
    const overridePath = ".agentship/override.json";
    await writeFile(path.join(root, overridePath), `${JSON.stringify(override)}\n`, "utf8");
    await run({ root, overridePath, binding, override });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a current hash-bound override records actor and removes verdict impact", async () => {
  await withOverrideFixture(async ({ root, overridePath, binding }) => {
    const loaded = await loadOverride(
      root,
      overridePath,
      binding,
      new Date("2026-09-21T00:00:00.000Z")
    );
    const overridden = applyOverride([finding], loaded);

    assert.equal(overridden[0]?.override?.actor, "release-manager@example.com");
    assert.equal(overridden[0]?.override?.reportSha256, loaded.sourceReport.sha256);
    assert.equal(calculateVerdict(overridden), "PASS");
  });
});

test("override rejects expired records and mismatched source report bindings", async () => {
  await withOverrideFixture(async ({ root, overridePath, binding, override }) => {
    await assert.rejects(
      loadOverride(
        root,
        overridePath,
        binding,
        new Date("2026-10-02T00:00:00.000Z")
      ),
      /expired/
    );

    await assert.rejects(
      loadOverride(
        root,
        overridePath,
        { ...binding, diffSha256: "e".repeat(64) },
        new Date("2026-09-21T00:00:00.000Z")
      ),
      /diff SHA-256 does not match/
    );

    const invalid = {
      ...override,
      report: { ...(override.report as object), sha256: "0".repeat(64) },
    };
    await writeFile(path.join(root, overridePath), JSON.stringify(invalid), "utf8");
    await assert.rejects(
      loadOverride(
        root,
        overridePath,
        binding,
        new Date("2026-09-21T00:00:00.000Z")
      ),
      /SHA-256 does not match/
    );
  });
});

test("override rejects protected approvals and targets absent from current findings", async () => {
  await withOverrideFixture(async ({ root, overridePath, binding, override }) => {
    const invalid = {
      ...override,
      findings: [
        { id: "protected", kind: "protected_path_approval_missing" },
      ],
    };
    await writeFile(path.join(root, overridePath), JSON.stringify(invalid), "utf8");
    await assert.rejects(
      loadOverride(
        root,
        overridePath,
        binding,
        new Date("2026-09-21T00:00:00.000Z")
      ),
      /not overrideable/
    );

    await writeFile(path.join(root, overridePath), JSON.stringify(override), "utf8");
    const loaded = await loadOverride(
      root,
      overridePath,
      binding,
      new Date("2026-09-21T00:00:00.000Z")
    );
    assert.throws(() => applyOverride([], loaded), /absent from the current/);
  });
});

test("review emits retained override evidence and an effective verdict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-override-review-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: root,
    });
    await writeFile(path.join(root, ".gitignore"), "/.agentship/\n", "utf8");
    await writeFile(path.join(root, "subject.txt"), "before\n", "utf8");
    await writeFile(
      path.join(root, ".agentship.yml"),
      `version: 1
mode: report
checks:
  - name: integration
    run: node --definitely-invalid-agent-ship-option
`,
      "utf8"
    );
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await writeFile(path.join(root, "subject.txt"), "after\n", "utf8");

    const initial = await runReview({
      cwd: root,
      outputPath: ".agentship/reviews/initial.json",
    });
    assert.equal(initial.report.verdict, "BLOCK");
    const reportSource = await readFile(initial.jsonPath);
    const overridePath = path.join(root, ".agentship", "overrides", "release.json");
    await mkdir(path.dirname(overridePath), { recursive: true });
    await writeFile(
      overridePath,
      JSON.stringify({
        schemaVersion: 1,
        id: "release-exception",
        actor: "release-manager@example.com",
        reason: "Time-bound exception for a known external outage.",
        expiresAt: "2099-10-01",
        report: {
          path: ".agentship/reviews/initial.json",
          sha256: createHash("sha256").update(reportSource).digest("hex"),
        },
        findings: [{ id: "check-1", kind: "required_check_failed" }],
      }),
      "utf8"
    );

    const accepted = await runReview({
      cwd: root,
      outputPath: ".agentship/reviews/accepted.json",
      overridePath: ".agentship/overrides/release.json",
    });
    assert.equal(accepted.report.verdict, "PASS");
    assert.equal(accepted.report.summary.overridden, 1);
    assert.equal(accepted.report.findings[0]?.override?.id, "release-exception");
    assert.match(
      await readFile(accepted.markdownPath, "utf8"),
      /OVERRIDDEN BLOCKER/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
