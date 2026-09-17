import test from "node:test";
import assert from "node:assert/strict";
import { buildPullRequestTask } from "../scripts/extract-pr-task.mjs";
import { parseTaskRequirements } from "../src/review/task-parser";

test("trusted task extraction preserves PR requirements without shell interpolation", () => {
  const markdown = buildPullRequestTask({
    pull_request: {
      title: "Fix refresh\nbehavior",
      body: "## Requirements\n\n1. Reject expired tokens.\n",
    },
  });
  assert.match(markdown, /^# Fix refresh behavior/);
  assert.equal(parseTaskRequirements(markdown)[0]?.text, "Reject expired tokens.");
});

test("trusted task extraction rejects missing events and oversized bodies", () => {
  assert.throws(() => buildPullRequestTask({}), /pull_request/);
  assert.throws(
    () =>
      buildPullRequestTask({
        pull_request: { title: "Large", body: "x".repeat(128 * 1024 + 1) },
      }),
    /exceeds/
  );
});
