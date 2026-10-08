import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectRunnerProvenance } from "../src/review/runner-provenance";

test("runner provenance binds runtime bytes, OS manifest, and hosted image metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-runner-provenance-"));
  try {
    const runtime = path.join(root, "node");
    const osRelease = path.join(root, "os-release");
    const runtimeBytes = Buffer.from("trusted-node-runtime\n", "utf8");
    const osReleaseBytes = Buffer.from(
      'ID="ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.5 LTS"\n',
      "utf8"
    );
    await writeFile(runtime, runtimeBytes);
    await writeFile(osRelease, osReleaseBytes);

    const provenance = await collectRunnerProvenance({
      platform: "linux",
      architecture: "x64",
      kernelRelease: "6.17.0-test",
      nodeVersion: "v20.20.0",
      nodeExecutable: runtime,
      osReleasePath: osRelease,
      environment: {
        RUNNER_ENVIRONMENT: "github-hosted",
        RUNNER_OS: "Linux",
        RUNNER_ARCH: "X64",
        ImageOS: "ubuntu24",
        ImageVersion: "20261005.1",
      },
    });

    assert.deepEqual(provenance, {
      platform: "linux",
      architecture: "x64",
      kernelRelease: "6.17.0-test",
      osRelease: {
        id: "ubuntu",
        versionId: "24.04",
        prettyName: "Ubuntu 24.04.5 LTS",
        sha256: createHash("sha256").update(osReleaseBytes).digest("hex"),
      },
      node: {
        version: "v20.20.0",
        executable: runtime,
        bytes: runtimeBytes.length,
        sha256: createHash("sha256").update(runtimeBytes).digest("hex"),
      },
      github: {
        environment: "github-hosted",
        runnerOs: "Linux",
        runnerArch: "X64",
        imageOs: "ubuntu24",
        imageVersion: "20261005.1",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner provenance rejects unsafe metadata and non-files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-runner-invalid-"));
  try {
    await assert.rejects(
      collectRunnerProvenance({
        platform: "linux",
        nodeExecutable: root,
        osReleasePath: path.join(root, "missing"),
      }),
      /Node executable must be a regular file/
    );
    const runtime = path.join(root, "node");
    const osRelease = path.join(root, "os-release");
    await writeFile(runtime, "runtime", "utf8");
    await writeFile(osRelease, "ID=test\n", "utf8");
    await assert.rejects(
      collectRunnerProvenance({
        platform: "linux",
        nodeExecutable: runtime,
        osReleasePath: osRelease,
        environment: { ImageVersion: "forged\nvalue" },
      }),
      /ImageVersion must be non-empty/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner provenance permits a minimal Linux filesystem without os-release", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-runner-minimal-"));
  try {
    const runtime = path.join(root, "node");
    await writeFile(runtime, "runtime", "utf8");
    const provenance = await collectRunnerProvenance({
      platform: "linux",
      nodeExecutable: runtime,
      osReleasePath: path.join(root, "missing-os-release"),
      environment: {},
    });
    assert.equal(provenance.osRelease, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
