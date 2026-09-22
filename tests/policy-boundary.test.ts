import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runReview } from "../src/review/review";

const execFileAsync = promisify(execFile);

test("external trusted policy wins over a weakened subject policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-policy-boundary-"));
  const subject = path.join(root, "subject");
  try {
    await execFileAsync("git", ["init", "-q", subject]);
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: subject,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: subject,
    });
    await writeFile(path.join(subject, "critical.ts"), "export const safe = true;\n");
    await writeFile(
      path.join(subject, ".agentship.yml"),
      `version: 1
mode: gate
checks:
  - name: required-security-check
    run: node --definitely-invalid-agentship-option
    required: true
policy:
  protectedPaths:
    - pattern: critical.ts
      requireManualApproval: true
`
    );
    await execFileAsync("git", ["add", "."], { cwd: subject });
    await execFileAsync("git", ["commit", "-qm", "trusted base"], {
      cwd: subject,
    });

    const trustedPolicy = path.join(root, "trusted-policy.yml");
    await writeFile(
      trustedPolicy,
      `version: 1
mode: gate
checks:
  - name: required-security-check
    run: node --definitely-invalid-agentship-option
    required: true
policy:
  protectedPaths:
    - pattern: critical.ts
      requireManualApproval: true
`
    );

    await writeFile(path.join(subject, "critical.ts"), "export const safe = false;\n");
    await writeFile(
      path.join(subject, ".agentship.yml"),
      `version: 1
mode: report
checks:
  - name: pretend-pass
    run: node --version
    required: false
policy:
  protectedPaths: []
`
    );

    const result = await runReview({
      cwd: subject,
      configPath: "../trusted-policy.yml",
      outputPath: ".agentship/reviews/trusted-policy.json",
    });

    assert.equal(result.report.mode, "gate");
    assert.equal(result.report.verdict, "BLOCK");
    assert.equal(result.report.configuration.path, "../trusted-policy.yml");
    assert.deepEqual(
      result.report.findings.map(({ kind }) => kind).sort(),
      ["protected_path_approval_missing", "required_check_failed"]
    );
    assert.equal(
      result.report.configuration.protectedPaths[0]?.approval,
      "required"
    );
    assert.equal(result.report.checks[0]?.name, "required-security-check");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
