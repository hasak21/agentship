import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowUrl = new URL(
  "../.github/workflows/agentship-report.yml",
  import.meta.url
);

test("CI report workflow keeps untrusted pull requests in a read-only context", async () => {
  const source = await readFile(workflowUrl, "utf8");
  const workflow = parse(source) as Record<string, unknown>;
  assert.ok(workflow.on && typeof workflow.on === "object");
  assert.ok("pull_request" in (workflow.on as Record<string, unknown>));
  assert.equal("pull_request_target" in (workflow.on as Record<string, unknown>), false);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.doesNotMatch(source, /\bsecrets\./);
  assert.match(source, /GITHUB_TOKEN: ""/);
  assert.match(source, /GH_TOKEN: ""/);
});

test("CI report uses immutable actions and separate trusted and subject checkouts", async () => {
  const source = await readFile(workflowUrl, "utf8");
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
    (match) => match[1]
  );
  assert.equal(uses.length, 4);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/);
  }
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(source, /path: verifier/);
  assert.match(source, /path: subject/);
  assert.equal((source.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.match(source, /node \.\.\/verifier\/dist\/agentship\.cjs review/);
  assert.match(source, /--config \.\.\/verifier\/\.agentship\.yml/);
  assert.doesNotMatch(source, /--approve-path/);
  assert.doesNotMatch(source, /--override/);
  assert.match(source, /subject\/\.agentship\/reviews\/ci\.\*/);
  assert.match(source, /GITHUB_STEP_SUMMARY/);
  assert.match(source, /subject\/\.agentship\/reviews\/ci\.md/);
});
