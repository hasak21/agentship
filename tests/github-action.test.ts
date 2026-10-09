import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowUrl = new URL(
  "../.github/workflows/agentship-report.yml",
  import.meta.url
);
const reusableWorkflowUrl = new URL(
  "../.github/workflows/agentship-report-reusable.yml",
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
  assert.doesNotMatch(source, /actions\/attest@/);
  assert.doesNotMatch(source, /\b(?:attestations|id-token):/);
});

test("CI report caller pins the reusable verifier to one immutable revision", async () => {
  const source = await readFile(workflowUrl, "utf8");
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(uses, [
    "hasak21/agentship/.github/workflows/agentship-report-reusable.yml@7e68cb44d67d66ac8cb00a4b84ae3e3a5994e41b",
  ]);
  assert.match(source, /verifier_repository: hasak21\/agentship/);
  assert.match(source, /verifier_ref: 7e68cb44d67d66ac8cb00a4b84ae3e3a5994e41b/);
});

test("reusable CI report separates verifier, base policy, and subject trust roots", async () => {
  const source = await readFile(reusableWorkflowUrl, "utf8");
  const workflow = parse(source) as Record<string, unknown>;
  assert.ok(workflow.on && typeof workflow.on === "object");
  assert.ok("workflow_call" in (workflow.on as Record<string, unknown>));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.match(source, /repository: \$\{\{ inputs\.verifier_repository \}\}/);
  assert.match(source, /ref: \$\{\{ inputs\.verifier_ref \}\}/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(source, /path: policy/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /path: subject/);
  assert.match(source, /--config \.\.\/policy\/\.agentship\.ci\.yml/);
  assert.equal((source.match(/persist-credentials: false/g) ?? []).length, 3);
  assert.doesNotMatch(source, /\bsecrets\./);
  assert.doesNotMatch(source, /pull_request_target/);
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
    (match) => match[1]
  );
  assert.equal(uses.length, 6);
  for (const action of uses) assert.match(action, /^[^@]+@[a-f0-9]{40}$/);
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
  assert.match(source, /--unshare-pid/);
  assert.match(source, /--unshare-ipc/);
  assert.match(source, /--unshare-uts/);
  assert.match(source, /--unshare-cgroup/);
  assert.match(source, /\/usr\/bin\/sudo -n -E \/usr\/bin\/unshare/);
  assert.match(source, /\/usr\/bin\/unshare/);
  assert.match(source, /--reuid="\$runner_uid"/);
  assert.match(source, /--regid="\$runner_gid"/);
  assert.match(source, /--clear-groups/);
  assert.match(source, /--bounding-set=-all/);
  assert.match(source, /--inh-caps=-all/);
  assert.match(source, /--ambient-caps=-all/);
  assert.doesNotMatch(source, /apt(?:-get)?\s+(?:update|install)/);
});
