import test from "node:test";
import assert from "node:assert/strict";
import { assessCausalBase } from "../src/review/causal-evidence";
import { runCheck } from "../src/review/runner";
import type { CheckEvidence } from "../src/review/types";

function evidence(overrides: Partial<CheckEvidence> = {}): CheckEvidence {
  return {
    name: "base", command: "test", required: true, network: "denied", environment: [],
    status: "failed", exitCode: 1, signal: null,
    startedAt: "2026-10-16T00:00:00.000Z", finishedAt: "2026-10-16T00:00:00.001Z",
    durationMs: 1, stdout: "", stderr: "", outputTruncated: false, ...overrides,
  };
}

test("causal base assessment rejects ambiguous shell exits and non-failure statuses", () => {
  for (const code of [0, -1, 126, 127, 128, 137, 255, 256, 1.5, NaN, Infinity, null]) {
    assert.equal(assessCausalBase(evidence({ exitCode: code })).satisfied, false, `exit ${code}`);
  }
  for (const status of ["passed", "timed_out", "skipped"] as const) {
    assert.equal(assessCausalBase(evidence({ status })).satisfied, false, status);
  }
  for (const exitCode of [1, 2, 3, 125]) {
    assert.deepEqual(assessCausalBase(evidence({ exitCode })), {
      satisfied: true, reason: "normal_nonzero_exit",
    });
  }
  assert.equal(assessCausalBase(evidence({ signal: "SIGKILL" })).reason, "base_signal");
});

test("resource, accounting and cleanup failures override ordinary nonzero exits", () => {
  for (const [exceeded, accountingFailed, reason] of [
    [true, false, "base_resource_limit"], [false, true, "base_accounting_failure"],
  ] as const) {
    assert.deepEqual(assessCausalBase(evidence({ execution: {
      backend: "linux-bubblewrap", writableStorage: {
        enforcement: "sampled-logical-bytes", limitBytes: 1, maxObservedBytes: 2,
        exceeded, accountingFailed,
      },
    } })), { satisfied: false, reason });
  }
  assert.deepEqual(assessCausalBase(evidence({ execution: {
    backend: "linux-bubblewrap", cleanupFailed: true,
  } })), { satisfied: false, reason: "base_cleanup_failed" });
});

test("actual shell execution failures and signal exits are not causal reproduction", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX shell conventions");
  const missing = await runCheck({ name: "missing", run: "agentship_missing_test_command_735" }, process.cwd());
  assert.equal(missing.exitCode, 127);
  assert.equal(assessCausalBase(missing).reason, "base_ambiguous_shell_exit");
  const signaled = await runCheck({ name: "signal", run: "sh -c 'kill -TERM $$'" }, process.cwd());
  assert.equal(assessCausalBase(signaled).satisfied, false);
  assert.ok(signaled.signal !== null || (signaled.exitCode ?? 0) > 128);
  const ordinary = await runCheck({ name: "ordinary", run: "sh -c 'exit 3'" }, process.cwd());
  assert.equal(assessCausalBase(ordinary).satisfied, true);
});
