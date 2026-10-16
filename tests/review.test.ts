import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  applyBlockingPolicy,
  applySuppressions,
  buildFindings,
  calculateVerdict,
  evaluateProtectedPaths,
  evaluateReviewBudgets,
  findProtectedRequirementIds,
  renderSarif,
  renderMarkdown,
  runReview,
  selectChangedFiles,
} from "../src/review/review";
import { mapRequirementsToChangedFiles } from "../src/review/requirement-mapper";
import {
  buildBubblewrapArguments,
  buildPrivilegedBubblewrapInvocation,
  measureWritableStorage,
  prepareBubblewrapSandbox,
} from "../src/review/sandbox";
import {
  buildCheckEnvironment,
  buildCheckInvocation,
  runCheck,
} from "../src/review/runner";
import type { CheckEvidence, ReviewReport } from "../src/review/types";

const execFileAsync = promisify(execFile);

function check(overrides: Partial<CheckEvidence> = {}): CheckEvidence {
  return {
    name: "test",
    command: "npm test",
    required: true,
    network: "unspecified",
    environment: [],
    status: "passed",
    exitCode: 0,
    signal: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    ...overrides,
  };
}

function reportWithFindings(
  findings: ReviewReport["findings"]
): ReviewReport {
  return {
    schemaVersion: 1,
    runId: "run-1",
    tool: { name: "AgentShip Verify", version: "0.1.0" },
    mode: "report",
    verdict: findings.some(({ severity }) => severity === "blocker")
      ? "BLOCK"
      : findings.length
      ? "WARN"
      : "PASS",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    repository: {
      root: "/repo",
      head: "head",
      postCheckHead: "head",
      reviewScope: "working-tree",
      diffSha256: "diff-hash",
      postCheckDiffSha256: "diff-hash",
      stableDuringChecks: true,
      changedFiles: [],
    },
    configuration: {
      path: ".agentship.yml",
      sha256: "config-hash",
      blockingPolicy: { configuredKinds: [] },
      protectedPaths: [],
    },
    checks: [],
    findings,
    summary: {
      passed: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      suppressed: 0,
      overridden: 0,
    },
  };
}

test("required failed checks produce a blocking verdict", () => {
  const findings = buildFindings([check({ status: "failed", exitCode: 1 })]);
  assert.equal(findings[0]?.kind, "required_check_failed");
  assert.equal(calculateVerdict(findings), "BLOCK");
});

test("optional failed checks produce a warning verdict", () => {
  const findings = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ]);
  assert.equal(findings[0]?.kind, "optional_check_failed");
  assert.equal(calculateVerdict(findings), "WARN");
});

test("writable-storage excess is a distinct non-optional blocker", () => {
  const findings = buildFindings([
    check({
      required: false,
      status: "failed",
      exitCode: null,
      execution: {
        backend: "linux-bubblewrap",
        writableStorage: {
          enforcement: "sampled-logical-bytes",
          limitBytes: 1024,
          maxObservedBytes: 2048,
          exceeded: true,
          accountingFailed: false,
        },
      },
    }),
  ]);
  assert.deepEqual(findings, [
    {
      id: "check-resource-1",
      severity: "blocker",
      kind: "check_resource_limit_exceeded",
      title: "Check 'test' exceeded its writable-storage limit",
      evidence: {
        check: "test",
        command: "npm test",
        budget: "workspace_bytes",
        observed: 2048,
        limit: 1024,
      },
    },
  ]);
});

test("writable-storage accounting loss fails closed for optional checks", () => {
  const findings = buildFindings([
    check({
      required: false,
      status: "failed",
      exitCode: null,
      execution: {
        backend: "linux-bubblewrap",
        writableStorage: {
          enforcement: "sampled-logical-bytes",
          limitBytes: 1024,
          maxObservedBytes: 512,
          exceeded: false,
          accountingFailed: true,
        },
      },
    }),
  ]);
  assert.equal(findings[0]?.kind, "check_resource_accounting_failed");
  assert.equal(findings[0]?.severity, "blocker");
});

test("repository policy promotes configured warning kinds to blockers", () => {
  const warning = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ]);
  const promoted = applyBlockingPolicy(warning, ["optional_check_failed"]);

  assert.equal(promoted[0]?.severity, "blocker");
  assert.equal(calculateVerdict(promoted), "BLOCK");
  assert.equal(warning[0]?.severity, "warning");
});

test("promoted blockers cannot be hidden by warning suppressions", () => {
  const warning = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ]);
  const [promoted] = applyBlockingPolicy(warning, ["optional_check_failed"]);
  assert.ok(promoted);

  const result = applySuppressions(
    [promoted],
    [
      {
        id: "optional-check-exception",
        findingId: promoted.id,
        kind: "optional_check_failed",
        owner: "quality-team",
        reason: "This suppression must not demote policy.",
        expiresAt: "2026-12-31",
      },
    ],
    new Date("2026-09-18T00:00:00.000Z")
  );

  assert.equal(result[0]?.suppression, undefined);
  assert.equal(calculateVerdict(result), "BLOCK");
});

test("all passing checks produce a pass verdict", () => {
  const findings = buildFindings([check()]);
  assert.deepEqual(findings, []);
  assert.equal(calculateVerdict(findings), "PASS");
});

test("Markdown evidence cannot be structurally forged by report text", () => {
  const report = reportWithFindings([
    {
      id: "hostile-finding",
      kind: "optional_check_failed",
      severity: "warning",
      title:
        "Observed issue\n## Forged result <img src=x onerror=alert(1)> https://attacker.test \u202ePASS",
      evidence: {},
    },
  ]);
  report.checks = [
    check({
      name: "test | forged-column",
      command: "echo `fake` | next-column",
    }),
  ];

  const markdown = renderMarkdown(report);

  assert.doesNotMatch(markdown, /\n## Forged result/);
  assert.doesNotMatch(markdown, /<img src=/);
  assert.doesNotMatch(markdown, /\u202e/);
  assert.doesNotMatch(markdown, /https:\/\/attacker\.test/);
  assert.match(markdown, /test \\| forged\\-column/);
  assert.match(
    markdown,
    /<code>echo `fake` &#124; next-column<\/code>/
  );
  assert.match(markdown, /&lt;img src\\=x onerror\\=alert\\\(1\\\)&gt;/);
});

test("Markdown evidence displays verifier entrypoint provenance", () => {
  const report = reportWithFindings([]);
  report.tool.verifier = {
    entrypoint: "/trusted/agentship.cjs",
    bytes: 415000,
    sha256: "9".repeat(64),
  };

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Verifier entrypoint: <code>\/trusted\/agentship\.cjs<\/code>/);
  assert.match(markdown, /Verifier bytes: 415000/);
  assert.ok(markdown.includes(`Verifier SHA-256: \`${"9".repeat(64)}\``));
});

test("Markdown evidence displays exact Git executable provenance", () => {
  const report = reportWithFindings([]);
  report.tool.git = {
    executable: "/usr/bin/git",
    version: "git version 2.43.0",
    bytes: 3660136,
    sha256: "6".repeat(64),
  };

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Git: <code>git version 2\.43\.0<\/code> at <code>\/usr\/bin\/git<\/code>/);
  assert.match(markdown, /Git bytes: 3660136/);
  assert.ok(markdown.includes(`Git SHA-256: \`${"6".repeat(64)}\``));
});

test("Markdown evidence displays runner and runtime provenance", () => {
  const report = reportWithFindings([]);
  report.runner = {
    platform: "linux",
    architecture: "x64",
    kernelRelease: "6.11.0-test",
    osRelease: {
      id: "ubuntu",
      versionId: "24.04",
      prettyName: "Ubuntu 24.04 LTS",
      sha256: "8".repeat(64),
    },
    node: {
      version: "v20.19.5",
      executable: "/opt/node/bin/node",
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
  };

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Runner: <code>linux\/x64<\/code>/);
  assert.match(markdown, /OS: <code>Ubuntu 24\.04 LTS<\/code>/);
  assert.ok(markdown.includes(`Node SHA-256: \`${"7".repeat(64)}\``));
  assert.match(markdown, /GitHub image: <code>ubuntu24\/20261005\.1<\/code>/);
});

test("Markdown evidence displays sampled writable-storage observations", () => {
  const report = reportWithFindings([]);
  report.checks = [
    check({
      execution: {
        backend: "linux-bubblewrap",
        resourceLimits: { maxWorkspaceMiB: 1 },
        writableStorage: {
          enforcement: "sampled-logical-bytes",
          limitBytes: 1024 * 1024,
          maxObservedBytes: 2 * 1024 * 1024,
          exceeded: true,
          accountingFailed: false,
        },
      },
    }),
  ];
  const markdown = renderMarkdown(report);
  assert.match(
    markdown,
    /storage=2097152\/1048576 logical bytes, exceeded=yes, accounting-failed=no/
  );
});

test("Linux resource limits produce an exact prlimit invocation", () => {
  const invocation = buildCheckInvocation(
    {
      name: "bounded",
      run: "npm test",
      resources: {
        cpuSeconds: 2,
        memoryMiB: 1024,
        maxFileSizeMiB: 8,
        maxOpenFiles: 256,
      },
    },
    "linux",
    true
  );

  assert.equal(invocation.file, "/usr/bin/prlimit");
  assert.equal(invocation.shell, false);
  assert.deepEqual(invocation.args, [
    "--core=0:0",
    "--cpu=2:2",
    "--as=1073741824:1073741824",
    "--fsize=8388608:8388608",
    "--nofile=256:256",
    "--",
    "/bin/sh",
    "-c",
    "npm test",
  ]);
  assert.deepEqual(invocation.execution, {
    backend: "linux-prlimit",
    resourceLimits: {
      cpuSeconds: 2,
      memoryMiB: 1024,
      maxFileSizeMiB: 8,
      maxOpenFiles: 256,
    },
  });
});

test("configured resource limits fail closed without the Linux backend", () => {
  assert.throws(
    () =>
      buildCheckInvocation(
        {
          name: "bounded",
          run: "npm test",
          resources: { cpuSeconds: 2 },
        },
        "darwin",
        false
      ),
    /require Linux with \/usr\/bin\/prlimit; the check was not executed/
  );
});

test("writable storage accounting counts logical file bytes without following symlinks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-storage-"));
  try {
    await mkdir(path.join(directory, "nested"));
    await writeFile(path.join(directory, "nested", "payload"), Buffer.alloc(1024));
    await symlink("payload", path.join(directory, "nested", "alias"));
    const usage = await measureWritableStorage(directory);
    assert.equal(usage.entries, 3);
    assert.equal(usage.bytes, 1024 + Buffer.byteLength("payload"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writable storage accounting tolerates entries removed during a sample", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-storage-race-"));
  try {
    const transient = path.join(directory, "transient");
    await writeFile(transient, "short-lived");
    const usage = await measureWritableStorage(directory, {
      readdir: (candidate) => readdir(candidate, { withFileTypes: true }),
      lstat: async (candidate) => {
        if (candidate === transient) {
          throw Object.assign(new Error("removed during accounting"), {
            code: "ENOENT",
          });
        }
        return lstat(candidate);
      },
    });
    assert.deepEqual(usage, { bytes: 0, entries: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writable storage accounting still fails closed on non-disappearance errors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-storage-error-"));
  try {
    const unreadable = path.join(directory, "unreadable");
    await writeFile(unreadable, "payload");
    await assert.rejects(
      measureWritableStorage(directory, {
        readdir: (candidate) => readdir(candidate, { withFileTypes: true }),
        lstat: async () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
      }),
      /permission denied/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bubblewrap invocation exposes only the disposable workspace and runtime", () => {
  const args = buildBubblewrapArguments({
    repositoryRoot: "/work/subject",
    workspace: "/tmp/copy",
    nodeModules: "/work/subject/node_modules",
    network: "denied",
    command: "npm test",
  });

  assert.ok(args.includes("--unshare-all"));
  assert.ok(args.includes("--share-net"));
  assert.deepEqual(args.slice(0, 4), ["--user", "--map-root-user", "--net", "/usr/bin/bwrap"]);
  assert.ok(args.includes("--bounding-set=-all"));
  assert.ok(args.includes("--inh-caps=-all"));
  assert.ok(args.includes("--ambient-caps=-all"));
  assert.deepEqual(args.slice(-3), ["/bin/sh", "-c", "npm test"]);
  assert.ok(args.some((value, index) =>
    value === "--bind" && args[index + 1] === "/tmp/copy" && args[index + 2] === "/work/subject"
  ));
  assert.equal(
    args.some((value, index) => value === "--ro-bind" && args[index + 1] === "/"),
    false
  );

  const allowed = buildBubblewrapArguments({
    repositoryRoot: "/work/subject",
    workspace: "/tmp/copy",
    network: "allowed",
    command: "npm test",
  });
  assert.ok(allowed.includes("--share-net"));
  assert.ok(allowed.includes("/etc/ssl"));
});

test("hosted denied-network invocation drops privilege before bubblewrap", () => {
  const invocation = buildPrivilegedBubblewrapInvocation({
    repositoryRoot: "/workspace/project",
    workspace: "/tmp/sandbox/workspace",
    network: "denied",
    command: "npm test",
  }, 1001, 121);

  assert.equal(invocation.file, "/usr/bin/sudo");
  assert.deepEqual(invocation.args.slice(0, 17), [
    "-n",
    "-E",
    "/usr/bin/unshare",
    "--net",
    "--",
    "/usr/bin/bwrap",
    "--die-with-parent",
    "--new-session",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-cgroup",
    "--share-net",
    "--unsetenv",
    "LOGNAME",
    "--unsetenv",
    "SUDO_COMMAND",
  ]);
  assert.ok(invocation.args.includes("--reuid=1001"));
  assert.ok(invocation.args.includes("--regid=121"));
  assert.ok(invocation.args.includes("--clear-groups"));
  assert.ok(invocation.args.includes("--bounding-set=-all"));
  assert.equal(invocation.args.includes("--unshare-all"), false);
  assert.deepEqual(invocation.args.slice(-3), ["/bin/sh", "-c", "npm test"]);
  assert.equal(invocation.args.filter((value) => value === "/usr/bin/setpriv").length, 1);
});

test("isolated resource limits wrap bubblewrap and unsupported hosts fail closed", async () => {
  const execution = {
    backend: "linux-bubblewrap" as const,
    resourceLimits: { cpuSeconds: 5 },
    isolation: {
      workspace: "disposable-copy" as const,
      hostFilesystem: "minimal-read-only-runtime" as const,
      network: "denied" as const,
    },
  };
  const invocation = buildCheckInvocation(
    {
      name: "isolated",
      run: "npm test",
      isolation: "bubblewrap",
      resources: { cpuSeconds: 5 },
    },
    "linux",
    true,
    {
      file: "/usr/bin/unshare",
      args: ["--unshare-all", "--", "/bin/sh", "-c", "npm test"],
      execution,
      measureWritableStorage: async () => ({ bytes: 0, entries: 0 }),
      cleanup: async () => {},
    }
  );
  assert.equal(invocation.file, "/usr/bin/prlimit");
  assert.deepEqual(invocation.args, [
    "--core=0:0",
    "--cpu=5:5",
    "--",
    "/usr/bin/unshare",
    "--unshare-all",
    "--",
    "/bin/sh",
    "-c",
    "npm test",
  ]);
  assert.deepEqual(invocation.execution, execution);

  await assert.rejects(
    prepareBubblewrapSandbox(
      { name: "isolated", run: "npm test", isolation: "bubblewrap" },
      process.cwd(),
      "darwin",
      false
    ),
    /requires Linux with \/usr\/bin\/bwrap, \/usr\/bin\/unshare, \/usr\/bin\/setpriv, and \/usr\/bin\/git; the check was not executed/
  );
});

test("Linux CPU limits stop a busy check before its wall timeout", async (context) => {
  if (process.platform !== "linux") {
    context.skip("Linux prlimit integration only");
    return;
  }
  try {
    await access("/usr/bin/prlimit");
  } catch {
    context.skip("/usr/bin/prlimit is unavailable");
    return;
  }

  const evidence = await runCheck(
    {
      name: "cpu-bound",
      run: 'node -e "for (;;) {}"',
      timeoutSeconds: 5,
      resources: { cpuSeconds: 1 },
    },
    process.cwd()
  );

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.execution?.backend, "linux-prlimit");
  assert.deepEqual(evidence.execution?.resourceLimits, { cpuSeconds: 1 });
  assert.ok(evidence.durationMs >= 700, `check stopped too early at ${evidence.durationMs} ms`);
  assert.ok(evidence.durationMs < 4_500, `check took ${evidence.durationMs} ms`);
});

test("bubblewrap discards mutations, hides host files, and denies network by default", async (context) => {
  if (process.env.AGENTSHIP_SANDBOX === "bubblewrap") {
    context.skip("nested bubblewrap is outside this integration test");
    return;
  }
  if (process.platform !== "linux") {
    context.skip("Linux bubblewrap integration only");
    return;
  }
  try {
    await access("/usr/bin/bwrap");
  } catch {
    context.skip("/usr/bin/bwrap is unavailable");
    return;
  }
  try {
    await execFileAsync("/usr/bin/unshare", [
      "--user",
      "--map-root-user",
      "--net",
      "/usr/bin/bwrap",
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--share-net",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--",
      "/usr/bin/setpriv",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--",
      "/usr/bin/true",
    ]);
  } catch {
    context.skip("host policy denies bubblewrap namespace creation");
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-isolation-"));
  try {
    await writeFile(path.join(directory, "subject.txt"), "original\n", "utf8");
    await writeFile(path.join(directory, ".gitignore"), "ignored-secret\n", "utf8");
    await writeFile(path.join(directory, "ignored-secret"), "host-only\n", "utf8");
    await execFileAsync("git", ["init"], { cwd: directory });
    await execFileAsync("git", ["add", ".gitignore", "subject.txt"], { cwd: directory });
    const evidence = await runCheck(
      {
        name: "isolated",
        run: `test ! -e /etc/passwd && test ! -e ignored-secret && touch sandbox-only && node -e "const fs = require('node:fs'); const network = fs.readFileSync('/proc/net/dev', 'utf8'); const names = network.split('\\n').slice(2).map((line) => line.split(':')[0].trim()).filter(Boolean); const status = fs.readFileSync('/proc/self/status', 'utf8').split('\\n'); const wanted = new Set(['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']); const capabilities = status.map((line) => line.split(':')).filter(([name]) => wanted.has(name)).map(([, value]) => value.trim()); const leaked = Object.keys(process.env).some((name) => name.startsWith('SUDO_') || name.startsWith('XDG_SESSION_') || name === 'XDG_RUNTIME_DIR' || name === 'USER' || name === 'LOGNAME'); if (names.some((name) => name !== 'lo') || capabilities.length !== wanted.size || capabilities.some((value) => !/^0+$/.test(value)) || leaked) process.exit(1)"`,
        timeoutSeconds: 10,
        isolation: "bubblewrap",
      },
      directory
    );

    assert.equal(evidence.status, "passed", evidence.stdout + evidence.stderr);
    assert.deepEqual(evidence.execution, {
      backend: "linux-bubblewrap",
      isolation: {
        workspace: "disposable-copy",
        hostFilesystem: "minimal-read-only-runtime",
        network: "denied",
      },
    });
    await assert.rejects(access(path.join(directory, "sandbox-only")));

    const storageEvidence = await runCheck(
      {
        name: "storage-bounded",
        run: "dd if=/dev/zero of=generated.bin bs=1048576 count=2 status=none && sleep 1",
        timeoutSeconds: 10,
        isolation: "bubblewrap",
        resources: { maxWorkspaceMiB: 1 },
      },
      directory
    );
    assert.equal(storageEvidence.status, "failed");
    assert.equal(storageEvidence.execution?.writableStorage?.exceeded, true);
    assert.equal(storageEvidence.execution?.writableStorage?.limitBytes, 1024 * 1024);
    assert.ok(
      (storageEvidence.execution?.writableStorage?.maxObservedBytes ?? 0) > 1024 * 1024
    );
    assert.match(storageEvidence.stderr, /writable storage exceeded/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active owned suppressions retain warning evidence but remove verdict impact", () => {
  const warning = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ])[0];
  assert.ok(warning);

  const suppressed = applySuppressions(
    [warning],
    [
      {
        id: "known-optional-failure",
        findingId: warning.id,
        kind: "optional_check_failed",
        owner: "quality-team",
        reason: "Replacement lands in issue 123.",
        expiresAt: "2026-12-31",
      },
    ],
    new Date("2026-09-18T00:00:00.000Z")
  );

  assert.deepEqual(suppressed[0]?.suppression, {
    id: "known-optional-failure",
    owner: "quality-team",
    reason: "Replacement lands in issue 123.",
    expiresAt: "2026-12-31",
  });
  assert.equal(calculateVerdict(suppressed), "PASS");
});

test("expired suppressions and blocker findings remain active", () => {
  const warning = buildFindings([
    check({ required: false, status: "failed", exitCode: 1 }),
  ])[0];
  assert.ok(warning);
  const expired = applySuppressions(
    [warning],
    [
      {
        id: "expired",
        findingId: warning.id,
        kind: "optional_check_failed",
        owner: "quality-team",
        reason: "The deadline passed.",
        expiresAt: "2026-09-17",
      },
    ],
    new Date("2026-09-18T00:00:00.000Z")
  );
  assert.equal(expired[0]?.suppression, undefined);
  assert.equal(calculateVerdict(expired), "WARN");

  const blocker = buildFindings([
    check({ required: true, status: "failed", exitCode: 1 }),
  ])[0];
  assert.ok(blocker);
  const unchanged = applySuppressions(
    [{ ...blocker, kind: "optional_check_failed" }],
    [
      {
        id: "cannot-hide-blocker",
        findingId: blocker.id,
        kind: "optional_check_failed",
        owner: "quality-team",
        reason: "Severity still prevents suppression.",
        expiresAt: "2026-12-31",
      },
    ],
    new Date("2026-09-18T00:00:00.000Z")
  );
  assert.equal(unchanged[0]?.suppression, undefined);
  assert.equal(calculateVerdict(unchanged), "BLOCK");
});

test("path-filtered checks select exact and directory changes", () => {
  const selected = selectChangedFiles(
    {
      name: "review-core",
      run: "npm test",
      whenChanged: ["src/review/**", "package.json"],
    },
    ["README.md", "src/review/review.ts", "package.json", "src/app/page.tsx"]
  );
  assert.deepEqual(selected, ["src/review/review.ts", "package.json"]);
});

test("skipped path-filtered checks do not fail unless explicitly required by a task", () => {
  const skipped = check({ status: "skipped", exitCode: null });
  assert.deepEqual(buildFindings([skipped]), []);

  const findings = buildFindings(
    [skipped],
    undefined,
    [
      {
        requirementId: "R1",
        status: "missing",
        references: [],
        missingReferences: [],
        checkEvidence: [{ name: "test", status: "skipped" }],
        symbolEvidence: [],
        missingRoles: [],
      },
    ]
  );
  assert.equal(findings[0]?.kind, "explicit_requirement_evidence_unsatisfied");
  assert.deepEqual(findings[0]?.evidence.expectedChecks, [
    { name: "test", status: "skipped" },
  ]);
});

test("causal checks block unless the passing head check fails normally on base", () => {
  const base = check({ status: "failed", exitCode: 1 });
  const reproduced = check({
    causal: {
      expectation: "fails_on_base",
      baseCommit: "a".repeat(40),
      testPaths: ["tests/**"],
      overlaidFiles: ["tests/regression.test.ts"],
      satisfied: true,
      base,
    },
  });
  assert.deepEqual(buildFindings([reproduced]), []);

  const notReproduced = check({
    causal: {
      expectation: "fails_on_base",
      baseCommit: "b".repeat(40),
      testPaths: ["tests/**"],
      overlaidFiles: ["tests/regression.test.ts"],
      satisfied: false,
      base: check(),
    },
  });
  const [finding] = buildFindings([notReproduced]);
  assert.equal(finding?.kind, "causal_check_not_reproduced");
  assert.equal(finding?.severity, "blocker");
  assert.equal(finding?.evidence.baseStatus, "passed");
});

test("causal evidence cannot accept infrastructure failures as reproduced regressions", () => {
  const invalidBases = [
    check({ status: "failed", exitCode: 0 }),
    check({ status: "failed", exitCode: 127 }),
    check({ status: "failed", exitCode: 137 }),
    check({ status: "failed", exitCode: 1, signal: "SIGTERM" }),
    check({ status: "failed", exitCode: 1, execution: { backend: "linux-bubblewrap", writableStorage: {
      enforcement: "sampled-logical-bytes", limitBytes: 1, maxObservedBytes: 2, exceeded: true, accountingFailed: false,
    } } }),
  ];
  for (const base of invalidBases) {
    const evidence = check({ causal: {
      expectation: "fails_on_base", baseCommit: "a".repeat(40),
      testPaths: ["tests/**"], overlaidFiles: ["tests/regression.ts"],
      satisfied: true, base,
    } });
    const [finding] = buildFindings([evidence]);
    assert.equal(finding?.kind, "causal_check_not_reproduced", `accepted base exit ${base.exitCode}`);
  }
});

test("causal review records fail-on-base and pass-on-head evidence", async (context) => {
  if (process.env.AGENTSHIP_SANDBOX === "bubblewrap") {
    context.skip("nested bubblewrap is outside this integration test");
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-causal-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: directory });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], { cwd: directory });
    await writeFile(path.join(directory, "value.txt"), "old\n", "utf8");
    await writeFile(path.join(directory, "regression.sh"), "test \"$(cat value.txt)\" = old\n", "utf8");
    await writeFile(path.join(directory, ".agentship.yml"), `version: 1
mode: report
checks:
  - name: regression
    run: sh regression.sh
    causal:
      expectation: fails_on_base
      testPaths:
        - regression.sh
    isolation: bubblewrap
    network: denied
`, "utf8");
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "base"], { cwd: directory });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
    const base = stdout.trim();
    await writeFile(path.join(directory, "value.txt"), "new\n", "utf8");
    await writeFile(path.join(directory, "regression.sh"), "test \"$(cat value.txt)\" = new\n", "utf8");
    await execFileAsync("git", ["add", "value.txt", "regression.sh"], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "head"], { cwd: directory });

    const result = await runReview({ cwd: directory, base, outputPath: ".agentship/reviews/causal.json" });
    assert.equal(result.report.verdict, "PASS");
    assert.equal(result.report.checks[0]?.status, "passed");
    assert.equal(result.report.checks[0]?.causal?.baseCommit, base);
    assert.equal(result.report.checks[0]?.causal?.base.status, "failed");
    assert.equal(result.report.checks[0]?.causal?.satisfied, true);
    assert.equal(result.report.checks[0]?.causal?.reason, "normal_nonzero_exit");
    assert.deepEqual(result.report.checks[0]?.causal?.overlaidFiles, ["regression.sh"]);
    assert.match(await import("node:fs/promises").then(({ readFile }) => readFile(result.markdownPath, "utf8")), /causal base=failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("causal review rejects a storage-only base failure with a zero shell exit", async (context) => {
  if (process.env.AGENTSHIP_SANDBOX === "bubblewrap") return context.skip("nested bubblewrap");
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-causal-storage-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: directory });
  try {
    await git(["init", "-q"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "AgentShip test"]);
    await writeFile(path.join(directory, "value.txt"), "old\n");
    await writeFile(path.join(directory, "regression.sh"), "exit 0\n");
    await writeFile(path.join(directory, ".agentship.yml"), `version: 1
mode: report
checks:
  - name: regression
    run: sh regression.sh
    isolation: bubblewrap
    network: denied
    resources:
      maxWorkspaceMiB: 1
    causal:
      expectation: fails_on_base
      testPaths:
        - regression.sh
`);
    await git(["add", "."]);
    await git(["commit", "-qm", "base"]);
    const { stdout: base } = await git(["rev-parse", "HEAD"]);
    await writeFile(path.join(directory, "value.txt"), "new\n");
    await writeFile(path.join(directory, "regression.sh"), 'if test "$(cat value.txt)" = old; then\n  dd if=/dev/zero of=generated.bin bs=1048576 count=2 status=none\nfi\nexit 0\n');
    await git(["add", "."]);
    await git(["commit", "-qm", "head"]);
    const { report } = await runReview({ cwd: directory, base: base.trim() });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[0].causal?.base.exitCode, 0);
    assert.equal(report.checks[0].causal?.base.execution?.writableStorage?.exceeded, true);
    assert.equal(report.checks[0].causal?.satisfied, false);
    assert.equal(report.checks[0].causal?.reason, "base_resource_limit");
    assert.equal(report.verdict, "BLOCK");
    assert.equal(report.findings[0]?.evidence.baseFailureReason, "base_resource_limit");
    assert.match(renderMarkdown(report), /reason=base_resource_limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("causal review refuses base overlay links and cleans up its worktree", async (context) => {
  if (process.env.AGENTSHIP_SANDBOX === "bubblewrap") return context.skip("nested bubblewrap");
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-causal-link-"));
  const repository = path.join(directory, "repository");
  const outside = path.join(directory, "outside");
  const git = (args: string[]) => execFileAsync("git", args, { cwd: repository });
  try {
    await mkdir(repository);
    await mkdir(outside);
    await writeFile(path.join(outside, "case.sh"), "outside sentinel");
    await git(["init", "-q"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "AgentShip test"]);
    await symlink(outside, path.join(repository, "tests"));
    await writeFile(path.join(repository, ".agentship.yml"), `version: 1
mode: report
checks:
  - name: regression
    run: sh tests/case.sh
    isolation: bubblewrap
    network: denied
    causal:
      expectation: fails_on_base
      testPaths:
        - tests/case.sh
`);
    await git(["add", "."]);
    await git(["commit", "-qm", "base with linked tests"]);
    const { stdout: base } = await git(["rev-parse", "HEAD"]);
    await rm(path.join(repository, "tests"));
    await mkdir(path.join(repository, "tests"));
    await writeFile(path.join(repository, "tests/case.sh"), "exit 0\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "head with regular tests"]);
    await assert.rejects(runReview({ cwd: repository, base: base.trim() }), { code: "ENOTDIR" });
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(path.join(outside, "case.sh"), "utf8"), "outside sentinel");
    const { stdout: worktrees } = await git(["worktree", "list", "--porcelain"]);
    assert.equal(worktrees.split("\n").filter(line => line.startsWith("worktree ")).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review input budgets produce evidence-backed blockers", () => {
  const excesses = evaluateReviewBudgets(
    { limits: { maxChangedFiles: 1, maxDiffBytes: 4 } },
    ["src/a.ts", "src/b.ts"],
    "12345"
  );
  assert.deepEqual(excesses, [
    { budget: "changed_files", observed: 2, limit: 1 },
    { budget: "diff_bytes", observed: 5, limit: 4 },
  ]);

  const findings = buildFindings([check()], undefined, [], [], undefined, excesses);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(({ kind }) => kind === "review_budget_exceeded"));
  assert.equal(calculateVerdict(findings), "BLOCK");
});

test("an exceeded review budget skips repository commands before execution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-budget-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: directory });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: directory,
    });
    await writeFile(path.join(directory, "subject.txt"), "before\n", "utf8");
    await writeFile(
      path.join(directory, ".agentship.yml"),
      `version: 1
mode: report
limits:
  maxDiffBytes: 1
checks:
  - name: must-not-run
    run: node -e "require('node:fs').writeFileSync('command-ran', 'yes')"
`,
      "utf8"
    );
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: directory });
    await writeFile(path.join(directory, "subject.txt"), "after\n", "utf8");

    const result = await runReview({
      cwd: directory,
      outputPath: ".agentship/reviews/budget.json",
    });

    assert.equal(result.report.verdict, "BLOCK");
    assert.ok(path.isAbsolute(result.report.tool.git?.executable ?? ""));
    assert.match(result.report.tool.git?.version ?? "", /^git version /);
    assert.ok((result.report.tool.git?.bytes ?? 0) > 0);
    assert.match(result.report.tool.git?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(result.report.checks[0]?.status, "skipped");
    assert.equal(
      result.report.checks[0]?.skipReason,
      "review_budget_exceeded"
    );
    await assert.rejects(access(path.join(directory, "command-ran")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aggregate check wall-clock budget clamps the active check and skips later work", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-check-budget-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: directory });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: directory,
    });
    await writeFile(
      path.join(directory, ".agentship.yml"),
      `version: 1
mode: report
limits:
  maxCheckSeconds: 0.05
checks:
  - name: exhaust-budget
    run: node -e "setTimeout(() => {}, 5000)"
    timeoutSeconds: 5
  - name: must-not-run
    run: node -e "require('node:fs').writeFileSync('command-ran', 'yes')"
`,
      "utf8"
    );
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: directory });

    const result = await runReview({
      cwd: directory,
      outputPath: ".agentship/reviews/check-budget.json",
    });

    assert.equal(result.report.verdict, "BLOCK");
    assert.equal(result.report.checks[0]?.status, "timed_out");
    assert.ok((result.report.checks[0]?.timeoutMs ?? Infinity) <= 50);
    assert.equal(result.report.checks[1]?.status, "skipped");
    assert.equal(result.report.checks[1]?.skipReason, "review_budget_exceeded");
    assert.ok(
      result.report.findings.some(
        ({ kind, evidence }) =>
          kind === "review_budget_exceeded" &&
          evidence.budget === "check_wall_clock_ms" &&
          evidence.limit === 50
      )
    );
    assert.equal(result.report.budget?.limits.maxCheckSeconds, 0.05);
    assert.ok((result.report.budget?.checkDurationMs ?? 0) >= 50);
    await assert.rejects(access(path.join(directory, "command-ran")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review blocks protected changes without relying on task annotations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-protected-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: directory });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.name", "AgentShip Test"], {
      cwd: directory,
    });
    await writeFile(path.join(directory, "payment.ts"), "export const amount = 1;\n", "utf8");
    await writeFile(
      path.join(directory, ".agentship.yml"),
      `version: 1
mode: report
checks:
  - name: test
    run: node -e "process.exit(0)"
policy:
  protectedPaths:
    - pattern: payment.ts
      requireManualApproval: true
`,
      "utf8"
    );
    await execFileAsync("git", ["add", "."], { cwd: directory });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: directory });
    await writeFile(path.join(directory, "payment.ts"), "export const amount = 2;\n", "utf8");

    const pending = await runReview({
      cwd: directory,
      outputPath: ".agentship/reviews/pending.json",
    });
    assert.equal(pending.report.verdict, "BLOCK");
    assert.equal(
      pending.report.findings[0]?.kind,
      "protected_path_approval_missing"
    );
    assert.equal(
      pending.report.configuration.protectedPaths[0]?.approval,
      "required"
    );

    const approved = await runReview({
      cwd: directory,
      outputPath: ".agentship/reviews/approved.json",
      approvedProtectedPathPatterns: ["payment.ts"],
    });
    assert.equal(approved.report.verdict, "PASS");
    assert.equal(approved.report.configuration.protectedPaths[0]?.approval, "confirmed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository mutation during checks produces a blocker", () => {
  const findings = buildFindings([check()], {
    stable: false,
    beforeHead: "before-head",
    afterHead: "after-head",
    beforeDiffSha256: "before-diff",
    afterDiffSha256: "after-diff",
  });

  assert.equal(findings[0]?.kind, "repository_changed_during_review");
  assert.equal(calculateVerdict(findings), "BLOCK");
  assert.equal(findings[0]?.evidence.afterDiffSha256, "after-diff");
});

test("requirements marked for confirmation block until confirmed", () => {
  const pending = buildFindings(
    [check()],
    undefined,
    [],
    [{ id: "R1", confirmation: "required" }]
  );
  assert.equal(pending[0]?.kind, "requirement_confirmation_missing");
  assert.equal(calculateVerdict(pending), "BLOCK");

  const confirmed = buildFindings(
    [check()],
    undefined,
    [],
    [{ id: "R1", confirmation: "confirmed" }]
  );
  assert.deepEqual(confirmed, []);
  assert.equal(calculateVerdict(confirmed), "PASS");
});

test("missing-path findings identify only unmatched requirement references", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R1",
        status: "missing",
        references: ["src/auth/session.ts", "tests/auth/session.test.ts"],
        missingReferences: ["tests/auth/session.test.ts"],
        checkEvidence: [],
        symbolEvidence: [],
        missingRoles: [],
      },
    ]
  );

  assert.deepEqual(findings[0]?.evidence.expectedPaths, [
    "tests/auth/session.test.ts",
  ]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("unsatisfied check annotations produce evidence-backed warnings", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R2",
        status: "missing",
        references: [],
        missingReferences: [],
        checkEvidence: [{ name: "integration", status: "not_configured" }],
        symbolEvidence: [],
        missingRoles: [],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "explicit_requirement_evidence_unsatisfied");
  assert.deepEqual(findings[0]?.evidence.expectedChecks, [
    { name: "integration", status: "not_configured" },
  ]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("inferred missing roles produce non-blocking, explicitly inferred warnings", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R3",
        status: "inferred_missing",
        references: [],
        missingReferences: [],
        checkEvidence: [],
        symbolEvidence: [],
        missingRoles: ["documentation"],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "inferred_requirement_role_missing");
  assert.deepEqual(findings[0]?.evidence.expectedRoles, ["documentation"]);
  assert.equal(calculateVerdict(findings), "WARN");
});

test("unsatisfied symbol annotations retain path, symbol, and diff status", () => {
  const findings = buildFindings(
    [check()],
    undefined,
    [
      {
        requirementId: "R4",
        status: "missing",
        references: [],
        missingReferences: [],
        checkEvidence: [],
        symbolEvidence: [
          {
            path: "src/auth/session.ts",
            symbol: "rotateKey",
            status: "symbol_not_in_diff",
          },
        ],
        missingRoles: [],
      },
    ]
  );

  assert.equal(findings[0]?.kind, "explicit_requirement_evidence_unsatisfied");
  assert.deepEqual(findings[0]?.evidence.expectedSymbols, [
    {
      path: "src/auth/session.ts",
      symbol: "rotateKey",
      status: "symbol_not_in_diff",
    },
  ]);
});

test("strict change coverage warns about unattributed files only when enabled", () => {
  const advisory = buildFindings(
    [check()],
    undefined,
    [],
    [],
    { strict: false, unattributedFiles: ["src/unexpected.ts"] }
  );
  assert.deepEqual(advisory, []);

  const strict = buildFindings(
    [check()],
    undefined,
    [],
    [],
    { strict: true, unattributedFiles: ["src/unexpected.ts"] }
  );
  assert.equal(strict[0]?.kind, "unattributed_changes");
  assert.deepEqual(strict[0]?.evidence.unexpectedPaths, ["src/unexpected.ts"]);
  assert.equal(calculateVerdict(strict), "WARN");
});

test("SARIF maps findings to rules, levels, and safe repository-relative locations", () => {
  const sarif = renderSarif(
    reportWithFindings([
      {
        id: "check-1",
        severity: "blocker",
        kind: "required_check_failed",
        title: "Required test failed",
        evidence: { check: "test" },
      },
      {
        id: "requirement-R1",
        severity: "warning",
        kind: "explicit_requirement_path_unchanged",
        title: "R1 path is unchanged",
        evidence: { expectedPaths: ["src/auth session.ts"] },
        suppression: {
          id: "known-gap",
          owner: "quality-team",
          reason: "Tracked in issue 123.",
          expiresAt: "2026-12-31",
        },
      },
      {
        id: "requirement-R2",
        severity: "warning",
        kind: "explicit_requirement_path_unchanged",
        title: "R2 path is unchanged",
        evidence: { expectedPaths: ["../outside.ts"] },
      },
    ])
  );

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0]?.tool.driver.rules.length, 2);
  assert.equal(sarif.runs[0]?.results[0]?.level, "error");
  assert.equal(sarif.runs[0]?.results[1]?.level, "warning");
  assert.equal(
    sarif.runs[0]?.results[1]?.locations?.[0]?.physicalLocation.artifactLocation.uri,
    "src/auth%20session.ts"
  );
  assert.deepEqual(sarif.runs[0]?.results[1]?.suppressions, [
    {
      kind: "external",
      status: "accepted",
      justification: "known-gap: Tracked in issue 123.",
    },
  ]);
  assert.deepEqual(
    sarif.runs[0]?.results[1]?.properties.suppression,
    {
      id: "known-gap",
      owner: "quality-team",
      reason: "Tracked in issue 123.",
      expiresAt: "2026-12-31",
    }
  );
  assert.equal("locations" in (sarif.runs[0]?.results[2] ?? {}), false);
  assert.deepEqual(sarif.runs[0]?.invocations[0]?.properties, {
    runId: "run-1",
    verdict: "BLOCK",
    diffSha256: "diff-hash",
  });
});

test("protected path policies select requirements with observed file or symbol evidence", () => {
  const diff = `diff --git a/src/payments/charge.ts b/src/payments/charge.ts
--- a/src/payments/charge.ts
+++ b/src/payments/charge.ts
@@ -1 +1 @@
-charge();
+authorizeCharge();`;
  const mappings = mapRequirementsToChangedFiles(
    [
      {
        id: "R1",
        text: "Update `change:src/payments/charge.ts`.",
        line: 1,
        confirmation: "not_required",
        confirmationBasis: [],
      },
      {
        id: "R2",
        text: "Change `symbol:src/payments/charge.ts#authorizeCharge`.",
        line: 2,
        confirmation: "not_required",
        confirmationBasis: [],
      },
      {
        id: "R3",
        text: "Update `change:src/profile.ts`.",
        line: 3,
        confirmation: "not_required",
        confirmationBasis: [],
      },
    ],
    ["src/payments/charge.ts", "src/profile.ts"],
    [],
    diff
  );

  assert.deepEqual(
    findProtectedRequirementIds(mappings, [
      { pattern: "src/payments/**", requireManualApproval: true },
      { pattern: "src/profile.ts", requireManualApproval: false },
    ]),
    ["R1", "R2"]
  );
});

test("protected path policies evaluate every observed changed file", () => {
  const pending = evaluateProtectedPaths(
    ["src/payments/charge.ts", "README.md"],
    [
      { pattern: "src/payments/**", requireManualApproval: true },
      { pattern: "README.md" },
      { pattern: "src/admin/**", requireManualApproval: true },
    ]
  );

  assert.deepEqual(pending, [
    {
      pattern: "src/payments/**",
      matchedFiles: ["src/payments/charge.ts"],
      approval: "required",
    },
    {
      pattern: "README.md",
      matchedFiles: ["README.md"],
      approval: "not_required",
    },
  ]);
  const findings = buildFindings(
    [check()],
    undefined,
    [],
    [],
    undefined,
    [],
    pending
  );
  assert.equal(findings[0]?.kind, "protected_path_approval_missing");
  assert.equal(findings[0]?.severity, "blocker");
  assert.deepEqual(findings[0]?.evidence.expectedPaths, [
    "src/payments/charge.ts",
  ]);
});

test("protected path approval must exactly match configured policy", () => {
  assert.throws(
    () =>
      evaluateProtectedPaths(
        ["src/payments/charge.ts"],
        [{ pattern: "src/payments/**", requireManualApproval: true }],
        ["src/**"]
      ),
    /does not match a configured approval policy/
  );

  assert.deepEqual(
    evaluateProtectedPaths(
      ["src/payments/charge.ts"],
      [{ pattern: "src/payments/**", requireManualApproval: true }],
      ["src/payments/**"]
    )[0]?.approval,
    "confirmed"
  );
});

test("check environments are allowlisted and secrets are redacted", async () => {
  const previousSecret = process.env.AGENTSHIP_TEST_SECRET;
  const previousIgnored = process.env.AGENTSHIP_TEST_IGNORED;
  const previousProxy = process.env.AGENTSHIP_TEST_PROXY;
  const previousSafeProxy = process.env.AGENTSHIP_TEST_SAFE_PROXY;
  process.env.AGENTSHIP_TEST_SECRET = "should-not-appear";
  process.env.AGENTSHIP_TEST_IGNORED = "not-allowed";
  process.env.AGENTSHIP_TEST_PROXY = "http://user:password@proxy.invalid";
  process.env.AGENTSHIP_TEST_SAFE_PROXY = "http://proxy.invalid:8080";

  try {
    const environment = buildCheckEnvironment({
      name: "environment",
      run: "ignored",
      environment: ["AGENTSHIP_TEST_SECRET"],
    });
    assert.equal(environment.AGENTSHIP_TEST_SECRET, "should-not-appear");
    assert.equal(environment.AGENTSHIP_TEST_IGNORED, undefined);
    const isolatedEnvironment = buildCheckEnvironment({
      name: "isolated-environment",
      run: "ignored",
      isolation: "bubblewrap",
      environment: [
        "AGENTSHIP_TEST_SECRET",
        "AGENTSHIP_TEST_PROXY",
        "AGENTSHIP_TEST_SAFE_PROXY",
      ],
    });
    assert.equal(isolatedEnvironment.AGENTSHIP_TEST_SECRET, undefined);
    assert.equal(isolatedEnvironment.AGENTSHIP_TEST_PROXY, undefined);
    assert.equal(
      isolatedEnvironment.AGENTSHIP_TEST_SAFE_PROXY,
      "http://proxy.invalid:8080"
    );

    const evidence = await runCheck(
      {
        name: "redaction",
        run:
          process.platform === "win32"
            ? `node -e "process.stdout.write(process.env.AGENTSHIP_TEST_SECRET)"`
            : `printf %s "$AGENTSHIP_TEST_SECRET"`,
        environment: ["AGENTSHIP_TEST_SECRET"],
      },
      process.cwd()
    );
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.stdout, "[REDACTED:AGENTSHIP_TEST_SECRET]");
    assert.ok(evidence.environment.includes("AGENTSHIP_TEST_SECRET"));
  } finally {
    if (previousSecret === undefined) delete process.env.AGENTSHIP_TEST_SECRET;
    else process.env.AGENTSHIP_TEST_SECRET = previousSecret;
    if (previousIgnored === undefined) delete process.env.AGENTSHIP_TEST_IGNORED;
    else process.env.AGENTSHIP_TEST_IGNORED = previousIgnored;
    if (previousProxy === undefined) delete process.env.AGENTSHIP_TEST_PROXY;
    else process.env.AGENTSHIP_TEST_PROXY = previousProxy;
    if (previousSafeProxy === undefined) delete process.env.AGENTSHIP_TEST_SAFE_PROXY;
    else process.env.AGENTSHIP_TEST_SAFE_PROXY = previousSafeProxy;
  }
});

test("timed-out checks terminate and record timeout evidence", async () => {
  const evidence = await runCheck(
    {
      name: "timeout",
      run: `node -e "setInterval(() => {}, 1000)"`,
      timeoutSeconds: 0.05,
    },
    process.cwd()
  );

  assert.equal(evidence.status, "timed_out");
  assert.ok(evidence.durationMs < 2_000);
});

test("malformed task annotations fail before repository commands execute", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-annotation-preflight-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: directory });
  try {
    await git(["init", "-q"]);
    await git(["config", "user.name", "Test"]);
    await git(["config", "user.email", "test@example.com"]);
    await writeFile(path.join(directory, ".agentship.yml"), 'version: 1\nmode: report\nchecks:\n  - name: smoke\n    run: node -e "require(\'node:fs\').writeFileSync(\'executed\', \'yes\')"\n');
    await writeFile(path.join(directory, "task.md"), "## Requirements\n1. Implement the feature.\n   Pass `check:`.\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "base"]);
    await assert.rejects(runReview({ cwd: directory, taskPath: "task.md" }), /Task requirement 'R1': Invalid check/);
    await assert.rejects(access(path.join(directory, "executed")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("review artifacts must not follow repository output links to host files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-output-link-"));
  const repository = path.join(directory, "repository");
  const outside = path.join(directory, "outside");
  try {
    await mkdir(repository);
    await mkdir(path.join(outside, "reviews"), { recursive: true });
    await writeFile(path.join(outside, "reviews/ci.json"), "outside sentinel");
    await writeFile(path.join(repository, ".gitignore"), ".agentship\n");
    await writeFile(path.join(repository, ".agentship.yml"), "version: 1\nmode: report\nchecks:\n  - name: smoke\n    run: node --version\n");
    const git = (args: string[]) => execFileAsync("git", args, { cwd: repository });
    await git(["init", "-q"]);
    await git(["config", "user.name", "Test"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["add", "."]);
    await git(["commit", "-qm", "base"]);
    await symlink(outside, path.join(repository, ".agentship"));
    await assert.rejects(runReview({ cwd: repository, outputPath: ".agentship/reviews/ci.json" }));
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(path.join(outside, "reviews/ci.json"), "utf8"), "outside sentinel");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("all Git review scopes reject deleted roles and task self-evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-role-deletion-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: directory });
  try {
    await git(["init", "-q"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "AgentShip test"]);
    await mkdir(path.join(directory, "tests"));
    await mkdir(path.join(directory, "docs"));
    await writeFile(path.join(directory, ".gitignore"), ".agentship/\n");
    await writeFile(path.join(directory, ".agentship.yml"), "version: 1\nmode: report\nchecks:\n  - name: smoke\n    run: node --version\n");
    await writeFile(path.join(directory, "tests/cart.test.ts"), "test('cart', () => {});\n");
    await writeFile(path.join(directory, "docs/guide.md"), "Guide\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "baseline"]);
    const { stdout: base } = await git(["rev-parse", "HEAD"]);
    await rm(path.join(directory, "tests/cart.test.ts"));
    await rm(path.join(directory, "docs/guide.md"));
    await writeFile(path.join(directory, "docs/task.md"), "## Requirements\n1. Add regression tests and update documentation.\n2. Remove obsolete `change:tests/cart.test.ts` and `change:docs/guide.md`.\n");
    const verify = async (scope: { staged?: boolean; base?: string }) => {
      const { report } = await runReview({ cwd: directory, taskPath: "docs/task.md", ...scope });
      const mappings = report.task!.mappings;
      assert.equal(mappings[0].status, "inferred_missing");
      assert.deepEqual(mappings[0].missingRoles, ["test", "documentation"]);
      assert.deepEqual(mappings[0].roleEvidence[1].excludedInputFiles, ["docs/task.md"]);
      assert.equal(mappings[1].status, "observed");
      assert.ok(report.findings.some(row => row.kind === "inferred_requirement_role_missing"));
      assert.match(renderMarkdown(report), /excluded deleted:/);
      assert.match(renderMarkdown(report), /excluded input:/);
    };
    await verify({});
    await git(["add", "-A"]);
    await verify({ staged: true });
    await git(["commit", "-qm", "destructive change"]);
    await verify({ base: base.trim() });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout does not wait indefinitely for escaped descendants holding output pipes", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX detached process groups");
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-pipe-timeout-"));
  let escapedPid: number | undefined;
  try {
    await writeFile(path.join(directory, "hold-pipes.cjs"), `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], {
        detached: true, stdio: ['ignore', 'inherit', 'inherit']
      });
      console.log('ESCAPED_PID=' + child.pid);
      child.unref();
    `);
    const evidence = await runCheck({
      name: "inherited-pipes", run: "node hold-pipes.cjs", timeoutSeconds: 0.25,
    }, directory);
    escapedPid = Number(evidence.stdout.match(/ESCAPED_PID=(\d+)/)?.[1]) || undefined;
    assert.ok(escapedPid, "fixture must launch the escaped descendant");
    assert.equal(evidence.status, "timed_out");
    assert.ok(evidence.durationMs < 2_500, `held pipes delayed completion to ${evidence.durationMs} ms`);
    assert.equal(evidence.outputTruncated, true);
    assert.match(evidence.stderr, /output pipes.*deadline/i);
  } finally {
    if (escapedPid) {
      try { process.kill(escapedPid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
