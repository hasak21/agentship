import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { buildCheckRunPayload } from "../scripts/build-check-run.mjs";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

function workflowEvent() {
  return {
    action: "completed",
    repository: {
      name: "agentship",
      full_name: "example/agentship",
      owner: { login: "example" },
    },
    workflow_run: {
      id: 1234,
      name: "AgentShip report",
      event: "pull_request",
      status: "completed",
      html_url: "https://github.com/example/agentship/actions/runs/1234",
      pull_requests: [{
        number: 42,
        head: { sha: HEAD_SHA },
        base: { sha: BASE_SHA },
      }],
    },
  };
}

function report() {
  return {
    schemaVersion: 1,
    runId: "report-run",
    tool: {
      name: "AgentShip Verify",
      version: "0.1.0",
      verifier: {
        entrypoint: "/home/runner/work/agentship/verifier/dist/agentship.cjs",
        bytes: 415000,
        sha256: "9".repeat(64),
      },
    },
    runner: {
      platform: "linux",
      architecture: "x64",
      kernelRelease: "6.11.0-1018-azure",
      osRelease: {
        id: "ubuntu",
        versionId: "24.04",
        prettyName: "Ubuntu 24.04.3 LTS",
        sha256: "8".repeat(64),
      },
      node: {
        version: "v20.19.5",
        executable: "/opt/hostedtoolcache/node/20.19.5/x64/bin/node",
        bytes: 123456789,
        sha256: "7".repeat(64),
      },
      github: {
        environment: "github-hosted",
        runnerOs: "Linux",
        runnerArch: "X64",
        imageOs: "ubuntu24",
        imageVersion: "20261005.1",
      },
    },
    verdict: "BLOCK",
    repository: {
      head: MERGE_SHA,
      base: BASE_SHA,
      reviewScope: "base",
      diffSha256: "d".repeat(64),
    },
    configuration: { sha256: "e".repeat(64) },
    task: { sha256: "f".repeat(64) },
    findings: [{ id: "finding-1" }],
  };
}

async function withPayloadFixture(
  run: (fixture: { root: string; eventPath: string; reportPath: string }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-check-publisher-"));
  try {
    const eventPath = path.join(root, "event.json");
    const reportPath = path.join(root, "report.json");
    await writeFile(eventPath, JSON.stringify(workflowEvent()), "utf8");
    await writeFile(reportPath, JSON.stringify(report()), "utf8");
    await run({ root, eventPath, reportPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Check Run payload is bound to the PR head and always neutral", async () => {
  await withPayloadFixture(async ({ root, eventPath, reportPath }) => {
    const payload = await buildCheckRunPayload({
      eventPath,
      reportPath,
      artifactRoot: root,
      expectedRepository: "example/agentship",
    });
    assert.equal(payload.head_sha, HEAD_SHA);
    assert.equal(payload.conclusion, "neutral");
    assert.equal(payload.output.title, "AgentShip report: BLOCK");
    assert.match(payload.output.summary, /not a merge gate/);
    assert.ok(
      payload.output.summary.includes(
        `Verifier SHA-256: \`${"9".repeat(64)}\``
      )
    );
    assert.match(payload.output.summary, /Runner image: `ubuntu24\/20261005\.1`/);
    assert.ok(
      payload.output.summary.includes(
        `Node: \`v20.19.5\` (SHA-256 \`${"7".repeat(64)}\`)`
      )
    );
    assert.equal(payload.details_url, "https://github.com/example/agentship/actions/runs/1234");
  });
});

test("Check Run payload requires bounded GitHub-hosted runner provenance", async () => {
  await withPayloadFixture(async ({ root, eventPath, reportPath }) => {
    const missing = report();
    delete (missing as { runner?: unknown }).runner;
    await writeFile(reportPath, JSON.stringify(missing), "utf8");
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /report runner must be an object/
    );

    await writeFile(
      reportPath,
      JSON.stringify({
        ...report(),
        runner: {
          ...report().runner,
          github: { ...report().runner.github, environment: "self-hosted" },
        },
      }),
      "utf8"
    );
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /expected GitHub-hosted Linux X64 runner/
    );

    await writeFile(
      reportPath,
      JSON.stringify({
        ...report(),
        runner: {
          ...report().runner,
          github: { ...report().runner.github, imageVersion: "forged\nsummary" },
        },
      }),
      "utf8"
    );
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /image version must be non-empty/
    );
  });
});

test("Check Run payload rejects missing or malformed verifier provenance", async () => {
  await withPayloadFixture(async ({ root, eventPath, reportPath }) => {
    const missing = report();
    delete (missing as { tool?: unknown }).tool;
    await writeFile(reportPath, JSON.stringify(missing), "utf8");
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /report tool must be an object/
    );

    await writeFile(
      reportPath,
      JSON.stringify({
        ...report(),
        tool: {
          ...report().tool,
          verifier: { ...report().tool.verifier, sha256: "untrusted" },
        },
      }),
      "utf8"
    );
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /verifier SHA-256 must be a lowercase SHA-256 digest/
    );
  });
});

test("Check Run payload rejects mismatched context and report bindings", async () => {
  await withPayloadFixture(async ({ root, eventPath, reportPath }) => {
    await assert.rejects(
      buildCheckRunPayload({
        eventPath,
        reportPath,
        artifactRoot: root,
        expectedRepository: "attacker/repository",
      }),
      /does not match GITHUB_REPOSITORY/
    );
    await writeFile(
      reportPath,
      JSON.stringify({
        ...report(),
        repository: { ...report().repository, base: HEAD_SHA },
      }),
      "utf8"
    );
    await assert.rejects(
      buildCheckRunPayload({ eventPath, reportPath, artifactRoot: root }),
      /base does not match/
    );
  });
});

test("validated reports are canonicalized only inside the trusted history directory", async () => {
  await withPayloadFixture(async ({ root, eventPath, reportPath }) => {
    const historyRoot = path.join(root, "history");
    const historyReportPath = path.join(historyRoot, "1234.json");
    await buildCheckRunPayload({
      eventPath,
      reportPath,
      artifactRoot: root,
      historyRoot,
      historyReportPath,
    });
    assert.deepEqual(
      JSON.parse(await readFile(historyReportPath, "utf8")),
      report()
    );

    await assert.rejects(
      buildCheckRunPayload({
        eventPath,
        reportPath,
        artifactRoot: root,
        historyRoot,
        historyReportPath: path.join(root, "outside.json"),
      }),
      /inside the history directory/
    );
  });
});

test("privileged publisher uses only trusted code and immutable actions", async () => {
  const workflowPath = new URL(
    "../.github/workflows/agentship-publish-check.yml",
    import.meta.url
  );
  const source = await readFile(workflowPath, "utf8");
  const workflow = parse(source) as Record<string, unknown>;
  assert.ok(workflow.on && typeof workflow.on === "object");
  assert.ok("workflow_run" in (workflow.on as Record<string, unknown>));
  assert.deepEqual(workflow.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
  });
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.equal(uses.length, 4);
  for (const action of uses) assert.match(action, /^[^@]+@[a-f0-9]{40}$/);
  assert.match(source, /github\.event\.repository\.default_branch/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /github\.event\.workflow_run\.pull_requests\[0\]\.number/);
  assert.match(source, /github\.event\.workflow_run\.id/);
  assert.match(source, /scripts\/build-check-run\.mjs/);
  assert.match(source, /cache-mode: write-only/);
  assert.match(source, /actions\/cache\/save@[a-f0-9]{40}/);
  assert.doesNotMatch(source, /actions\/cache\/restore@/);
  assert.match(source, /agentship-history-v1-pr-/);
  assert.ok(
    source.indexOf("scripts/build-check-run.mjs") <
      source.indexOf("actions/cache/save@")
  );
  assert.doesNotMatch(source, /pull_request_target/);
  assert.doesNotMatch(source, /checkout[^\n]*head_sha/);
});
