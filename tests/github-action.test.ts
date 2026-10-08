import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowUrl = new URL(
  "../.github/workflows/agentship-report.yml",
  import.meta.url
);
const ciPolicyUrl = new URL("../.agentship.ci.yml", import.meta.url);
const installerUrl = new URL("../scripts/install-ci-bubblewrap.sh", import.meta.url);

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
  assert.equal(uses.length, 5);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/);
  }
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(source, /path: verifier/);
  assert.match(source, /path: subject/);
  assert.equal((source.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.match(source, /node \.\.\/verifier\/dist\/agentship\.cjs review/);
  assert.match(source, /--config \.\.\/verifier\/\.agentship\.ci\.yml/);
  assert.match(source, /working-directory: verifier\n\s+run: scripts\/install-ci-bubblewrap\.sh/);
  assert.match(source, /test -x \/usr\/bin\/prlimit/);
  assert.doesNotMatch(source, /--approve-path/);
  assert.doesNotMatch(source, /--override/);
  assert.match(source, /subject\/\.agentship\/reviews\/ci\.\*/);
  assert.match(source, /GITHUB_STEP_SUMMARY/);
  assert.match(source, /subject\/\.agentship\/reviews\/ci\.md/);
  assert.match(source, /cache-mode: read/);
  assert.match(source, /actions\/cache\/restore@[a-f0-9]{40}/);
  assert.doesNotMatch(source, /actions\/cache\/save@/);
  assert.match(source, /agentship-history-v1-pr-/);
  assert.match(source, /--history \.agentship\/history/);
});

test("CI policy isolates checks without claiming a Node memory limit", async () => {
  const policy = parse(await readFile(ciPolicyUrl, "utf8")) as {
    checks?: Array<{
      name: string;
      network?: string;
      resources?: Record<string, number>;
      isolation?: string;
    }>;
  };

  assert.ok(policy.checks?.length);
  for (const check of policy.checks ?? []) {
    assert.ok(check.resources?.cpuSeconds);
    assert.ok(check.resources?.maxFileSizeMiB);
    assert.ok(check.resources?.maxOpenFiles);
    assert.equal(check.resources?.memoryMiB, undefined);
    assert.equal(check.isolation, "bubblewrap");
    assert.equal(check.network, "denied");
  }
});

test("CI provisions a fixed digest-verified bubblewrap worker", async () => {
  const source = await readFile(installerUrl, "utf8");

  assert.match(source, /BUBBLEWRAP_VERSION="0\.9\.0-1ubuntu0\.3"/);
  assert.match(source, /BUBBLEWRAP_SHA256="[a-f0-9]{64}"/);
  assert.match(
    source,
    /https:\/\/security\.ubuntu\.com\/ubuntu\/pool\/main\/b\/bubblewrap\//
  );
  assert.match(source, /sha256sum --check --strict/);
  assert.match(source, /sudo dpkg --install/);
  assert.match(source, /test ! -u \/usr\/bin\/bwrap/);
  assert.match(source, /--unshare-all/);
  assert.doesNotMatch(source, /apt(?:-get)?\s+(?:update|install)/);
});
