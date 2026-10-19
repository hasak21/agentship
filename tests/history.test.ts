import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  findLatestCompatibleHistory,
  resolveHistoryDirectory,
} from "../src/review/history";
import { runReview } from "../src/review/review";

const execFileAsync = promisify(execFile);

test("history refuses malformed UTF-8 and oversized report bytes before compatibility selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-encoding-"));
  const directory = path.join(root, ".agentship/history");
  const context = { configurationSha256: "config", reviewScope: "working-tree" as const };
  try {
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, "latest.json");
    const source = Buffer.from(JSON.stringify({
      schemaVersion: 1, runId: "\ufffd", repository: { reviewScope: "working-tree" }, configuration: { sha256: "config" },
    }));
    await writeFile(filename, source);
    assert.equal(await findLatestCompatibleHistory(root, ".agentship/history", context), path.relative(root, filename));
    const position = source.indexOf(Buffer.from("\ufffd"));
    await writeFile(filename, Buffer.concat([source.subarray(0, position), Buffer.from([0xff]), source.subarray(position + 3)]));
    await assert.rejects(findLatestCompatibleHistory(root, ".agentship/history", context), /History report must contain valid UTF-8/);
    await writeFile(filename, Buffer.alloc(5 * 1024 * 1024 + 1, 32));
    await assert.rejects(findLatestCompatibleHistory(root, ".agentship/history", context), /5242880 bytes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("history directory must remain inside the repository", () => {
  assert.throws(
    () => resolveHistoryDirectory("/repo", "../history"),
    /repository-relative child path/
  );
  assert.throws(
    () => resolveHistoryDirectory("/repo", "."),
    /repository-relative child path/
  );
  assert.deepEqual(resolveHistoryDirectory("/repo", ".agentship/history"), {
    absolutePath: "/repo/.agentship/history",
    relativePath: ".agentship/history",
  });
});

test("base history requires the same resolved commit and skips legacy missing identities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-pinned-"));
  try {
    const directory = path.join(root, "history");
    await mkdir(directory);
    for (const [name, baseCommit] of [["a-correct", "a".repeat(40)], ["z-wrong", "b".repeat(40)], ["zz-legacy", undefined]]) {
      await writeFile(path.join(directory, `${name}.json`), JSON.stringify({
        schemaVersion: 1, configuration: { sha256: "config" }, repository: { reviewScope: "base", base: "comparison", baseCommit },
      }));
    }
    assert.equal(await findLatestCompatibleHistory(root, "history", {
      configurationSha256: "config", reviewScope: "base", base: "comparison", baseCommit: "a".repeat(40),
    }), path.join("history", "a-correct.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing history has no compatible baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-empty-"));
  try {
    assert.equal(
      await findLatestCompatibleHistory(root, ".agentship/history", {
        configurationSha256: "c".repeat(64),
        reviewScope: "working-tree",
      }),
      undefined
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("history rejects a repository path redirected through a symbolic link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentship-history-outside-"));
  try {
    await mkdir(path.join(root, ".agentship"), { recursive: true });
    await symlink(outside, path.join(root, ".agentship", "history"), "dir");
    await assert.rejects(
      findLatestCompatibleHistory(root, ".agentship/history", {
        configurationSha256: "c".repeat(64),
        reviewScope: "working-tree",
      }),
      /must not traverse a symbolic link/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("automatic history skips newer incompatible reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-match-"));
  try {
    const directory = path.join(root, ".agentship", "history");
    await mkdir(directory, { recursive: true });
    const report = (configurationSha256: string, taskSha256?: string) => ({
      schemaVersion: 1,
      configuration: { sha256: configurationSha256 },
      repository: { reviewScope: "working-tree" },
      ...(taskSha256 ? { task: { sha256: taskSha256 } } : {}),
    });
    await writeFile(
      path.join(directory, "2026-09-20-compatible.json"),
      JSON.stringify(report("c".repeat(64), "t".repeat(64)))
    );
    await writeFile(
      path.join(directory, "2026-09-21-incompatible.json"),
      JSON.stringify(report("d".repeat(64), "t".repeat(64)))
    );

    assert.equal(
      await findLatestCompatibleHistory(root, ".agentship/history", {
        configurationSha256: "c".repeat(64),
        taskSha256: "t".repeat(64),
        reviewScope: "working-tree",
      }),
      ".agentship/history/2026-09-20-compatible.json"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review records durable history and automatically compares a compatible run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-history-review-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: root,
    });
    await writeFile(
      path.join(root, ".gitignore"),
      "/.agentship/reviews/\n/.agentship/history/\n",
      "utf8"
    );
    await writeFile(path.join(root, "subject.txt"), "before\n", "utf8");
    await writeFile(
      path.join(root, ".agentship.yml"),
      `version: 1
mode: report
checks:
  - name: optional-check
    run: node --definitely-invalid-agentship-option
    required: false
`,
      "utf8"
    );
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await writeFile(path.join(root, "subject.txt"), "after\n", "utf8");

    const first = await runReview({
      cwd: root,
      outputPath: ".agentship/reviews/first.json",
      historyDirectory: ".agentship/history",
    });
    assert.equal(first.report.history?.selection, "none_found");
    assert.ok(first.historyJsonPath);
    await access(first.historyJsonPath);

    const second = await runReview({
      cwd: root,
      outputPath: ".agentship/reviews/second.json",
      historyDirectory: ".agentship/history",
    });
    assert.equal(second.report.history?.selection, "automatic_compatible");
    assert.equal(second.report.baseline?.runId, first.report.runId);
    assert.equal(second.report.baseline?.existingFindings.length, 1);
    assert.equal(second.report.baseline?.newFindings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
