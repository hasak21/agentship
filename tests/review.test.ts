import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("bubblewrap invocation exposes only the disposable workspace and runtime", () => {
  const args = buildBubblewrapArguments({
    repositoryRoot: "/work/subject",
    workspace: "/tmp/copy",
    nodeModules: "/work/subject/node_modules",
    network: "denied",
    command: "npm test",
  });

  assert.ok(args.includes("--unshare-all"));
  assert.equal(args.includes("--share-net"), false);
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
    { args: ["--unshare-all", "--", "/bin/sh", "-c", "npm test"], execution, cleanup: async () => {} }
  );
  assert.equal(invocation.file, "/usr/bin/prlimit");
  assert.deepEqual(invocation.args, [
    "--core=0:0",
    "--cpu=5:5",
    "--",
    "/usr/bin/bwrap",
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
    /requires Linux with \/usr\/bin\/bwrap and \/usr\/bin\/git; the check was not executed/
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
    await execFileAsync("/usr/bin/bwrap", [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
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
        run: `test ! -e /etc/passwd && test ! -e ignored-secret && touch sandbox-only && node -e "const source = require('node:fs').readFileSync('/proc/net/dev', 'utf8'); const names = source.split('\\n').slice(2).map((line) => line.split(':')[0].trim()).filter(Boolean); if (names.some((name) => name !== 'lo')) process.exit(1)"`,
        timeoutSeconds: 10,
        isolation: "bubblewrap",
      },
      directory
    );

    assert.equal(evidence.status, "passed", evidence.stderr);
    assert.deepEqual(evidence.execution, {
      backend: "linux-bubblewrap",
      isolation: {
        workspace: "disposable-copy",
        hostFilesystem: "minimal-read-only-runtime",
        network: "denied",
      },
    });
    await assert.rejects(access(path.join(directory, "sandbox-only")));
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
