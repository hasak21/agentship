import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "agentship-cli-"));
const isolatedCli = path.join(temporaryDirectory, "agentship.cjs");
const intentFixture = path.resolve("fixtures/intent/executable-patch-corpus.json");

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  await copyFile(path.resolve("dist/agentship.cjs"), isolatedCli);
  const { stdout } = await execFileAsync(process.execPath, [isolatedCli, "review", "--help"], {
    cwd: temporaryDirectory,
    encoding: "utf8",
  });
  const requiredHelp = [
    "AgentShip Verify",
    "agentship init",
    "agentship ci-init",
    "agentship doctor",
    "--task <path>",
    "--baseline <path>",
    "--override <path>",
    "--history <dir>",
    "agentship outcome",
    "agentship metrics",
    "agentship leaderboard",
    "agentship verify-signature",
    "--signing-key <path>",
    "--approve-path <pattern>",
  ];
  const missingHelp = requiredHelp.filter((fragment) => !stdout.includes(fragment));
  if (missingHelp.length > 0) {
    throw new Error(
      `Bundled CLI help output is missing: ${missingHelp.join(", ")}; received ${JSON.stringify(stdout)}.`
    );
  }
  const benchmark = await execFileAsync(
    process.execPath,
    [isolatedCli, "benchmark", "--fixtures", intentFixture],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const report = JSON.parse(benchmark.stdout);
  if (
    report.schemaVersion !== 1 ||
    report.corpus.kind !== "executable_patch" ||
    report.corpus.cases !== 12
  ) {
    throw new Error("Bundled CLI benchmark output is incomplete.");
  }
  const initializedRepository = path.join(temporaryDirectory, "initialized");
  await mkdir(initializedRepository);
  await execFileAsync("git", ["init", "-q"], { cwd: initializedRepository });
  await writeFile(path.join(initializedRepository, "package.json"), JSON.stringify({
    scripts: { test: "node --test" },
  }));
  await writeFile(path.join(initializedRepository, "package-lock.json"), "{}\n");
  await execFileAsync(process.execPath, [isolatedCli, "init"], {
    cwd: initializedRepository,
    encoding: "utf8",
  });
  const doctorRun = await execFileAsync(process.execPath, [isolatedCli, "doctor"], {
    cwd: initializedRepository,
    encoding: "utf8",
  });
  const diagnosis = JSON.parse(doctorRun.stdout);
  if (!diagnosis.ready || diagnosis.checks?.[0]?.name !== "test") {
    throw new Error("Bundled CLI init/doctor output is incomplete.");
  }
  const verifierRef = "c".repeat(40);
  const ciInitialization = await execFileAsync(
    process.execPath,
    [isolatedCli, "ci-init", "--repository", "example/agentship", "--ref", verifierRef],
    { cwd: initializedRepository, encoding: "utf8" }
  );
  if (!ciInitialization.stdout.includes(`Verifier: example/agentship@${verifierRef}`)) {
    throw new Error("Bundled CLI ci-init output is incomplete.");
  }
  const reportCaller = await readFile(
    path.join(initializedRepository, ".github/workflows/agentship-report.yml"),
    "utf8"
  );
  if (!reportCaller.includes(`agentship-report-reusable.yml@${verifierRef}`)) {
    throw new Error("Bundled CLI ci-init did not pin its reusable report workflow.");
  }
  const sourceReport = {
    schemaVersion: 1,
    runId: "standalone-run",
    finishedAt: "2026-09-24T00:00:00.000Z",
    repository: {
      head: "standalone-head",
      diffSha256: "a".repeat(64),
      reviewScope: "working-tree",
    },
    configuration: { sha256: "b".repeat(64) },
    findings: [{
      id: "standalone-finding",
      kind: "required_check_failed",
      severity: "blocker",
      title: "Required check failed",
    }],
  };
  await mkdir(path.join(temporaryDirectory, "reports"));
  await writeFile(
    path.join(temporaryDirectory, "reports", "report.json"),
    `${JSON.stringify(sourceReport)}\n`,
    "utf8"
  );
  const outcome = await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "outcome",
      "--report",
      "reports/report.json",
      "--finding-id",
      "standalone-finding",
      "--finding-kind",
      "required_check_failed",
      "--status",
      "accepted",
      "--actor",
      "cli-verifier",
      "--reason",
      "Standalone verification.",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const recordPath = outcome.stdout.match(/^Record: (.+)$/m)?.[1];
  if (!recordPath) throw new Error("Bundled CLI outcome output is incomplete.");
  const record = JSON.parse(
    await readFile(path.join(temporaryDirectory, recordPath), "utf8")
  );
  if (record.status !== "accepted" || record.finding.id !== "standalone-finding") {
    throw new Error("Bundled CLI outcome record is incomplete.");
  }
  await copyFile(intentFixture, path.join(temporaryDirectory, "corpus.json"));
  const calibration = await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "metrics",
      "--outcomes",
      ".agentship/outcomes",
      "--reports",
      "reports",
      "--benchmark-fixtures",
      "corpus.json",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const metrics = JSON.parse(calibration.stdout);
  if (
    metrics.schemaVersion !== 1 ||
    metrics.samples.reviews !== 1 ||
    metrics.samples.trackedFindings !== 1 ||
    metrics.recall.cases !== 12
  ) {
    throw new Error("Bundled CLI calibration metrics are incomplete.");
  }

  const leaderboardDirectory = path.join(temporaryDirectory, "leaderboard");
  await mkdir(leaderboardDirectory);
  const leaderboardTaskSha = createHash("sha256").update("task").digest("hex");
  const leaderboardSuiteSha = createHash("sha256").update("suite").digest("hex");
  const leaderboardReport = `${JSON.stringify({
    schemaVersion: 1,
    verdict: "PASS",
    task: { sha256: leaderboardTaskSha },
    checks: [],
    findings: [],
  })}\n`;
  await writeFile(path.join(leaderboardDirectory, "report.json"), leaderboardReport);
  await writeFile(path.join(leaderboardDirectory, "agent.submission.json"), `${JSON.stringify({
    schemaVersion: 1,
    type: "agentship.agent-evaluation",
    submissionId: "standalone-agent",
    agent: { name: "Standalone Agent", model: "fixture" },
    suite: { id: "standalone-suite", sha256: leaderboardSuiteSha },
    tasks: [{
      id: "task",
      taskSha256: leaderboardTaskSha,
      report: "report.json",
      reportSha256: createHash("sha256").update(leaderboardReport).digest("hex"),
    }],
  })}\n`);
  const leaderboardRun = await execFileAsync(
    process.execPath,
    [isolatedCli, "leaderboard", "--submissions", leaderboardDirectory],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const leaderboard = JSON.parse(leaderboardRun.stdout);
  if (leaderboard.submissions?.[0]?.metrics?.passRate !== 1) {
    throw new Error("Bundled CLI leaderboard output is incomplete.");
  }

  const reviewRepository = path.join(temporaryDirectory, "signed-review");
  const keyDirectory = path.join(temporaryDirectory, "trusted-keys");
  await mkdir(reviewRepository);
  await mkdir(keyDirectory);
  await writeFile(
    path.join(reviewRepository, ".agentship.yml"),
    "version: 1\nmode: report\nchecks:\n  - name: smoke\n    run: node -e \"process.exit(0)\"\n",
    "utf8"
  );
  await writeFile(path.join(reviewRepository, "subject.txt"), "signed evidence\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: reviewRepository });
  await execFileAsync("git", ["config", "user.email", "verify@example.com"], {
    cwd: reviewRepository,
  });
  await execFileAsync("git", ["config", "user.name", "CLI Verifier"], {
    cwd: reviewRepository,
  });
  await execFileAsync("git", ["add", "."], { cwd: reviewRepository });
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: reviewRepository });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(keyDirectory, "private.pem");
  const publicKeyPath = path.join(keyDirectory, "public.pem");
  await writeFile(
    privateKeyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 }
  );
  await writeFile(
    publicKeyPath,
    publicKey.export({ format: "pem", type: "spki" }),
    "utf8"
  );
  const signedReview = await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "review",
      "--output",
      ".agentship/reviews/signed.json",
      "--signing-key",
      privateKeyPath,
    ],
    { cwd: reviewRepository, encoding: "utf8" }
  );
  if (!signedReview.stdout.includes("Signature: .agentship/reviews/signed.sig.json")) {
    throw new Error("Bundled CLI did not emit detached signature evidence.");
  }
  const reviewEvidence = JSON.parse(
    await readFile(path.join(reviewRepository, ".agentship/reviews/signed.json"), "utf8")
  );
  const isolatedCliBytes = await readFile(isolatedCli);
  const expectedVerifierSha256 = createHash("sha256")
    .update(isolatedCliBytes)
    .digest("hex");
  if (
    reviewEvidence.tool?.verifier?.entrypoint !== isolatedCli ||
    reviewEvidence.tool.verifier.bytes !== isolatedCliBytes.length ||
    reviewEvidence.tool.verifier.sha256 !== expectedVerifierSha256
  ) {
    throw new Error("Bundled CLI report is not bound to the exact standalone artifact.");
  }
  const nodeExecutable = await realpath(process.execPath);
  const nodeStats = await stat(nodeExecutable);
  const expectedNodeSha256 = await sha256File(nodeExecutable);
  if (
    reviewEvidence.runner?.node?.version !== process.version ||
    reviewEvidence.runner.node.executable !== nodeExecutable ||
    reviewEvidence.runner.node.bytes !== nodeStats.size ||
    reviewEvidence.runner.node.sha256 !== expectedNodeSha256 ||
    reviewEvidence.runner.platform !== process.platform ||
    reviewEvidence.runner.architecture !== process.arch
  ) {
    throw new Error("Bundled CLI report is not bound to the launching Node runtime.");
  }
  const gitExecutable = reviewEvidence.tool?.git?.executable;
  if (typeof gitExecutable !== "string") {
    throw new Error("Bundled CLI report is missing Git executable provenance.");
  }
  const gitStats = await stat(gitExecutable);
  const expectedGitSha256 = await sha256File(gitExecutable);
  if (
    reviewEvidence.tool.git.bytes !== gitStats.size ||
    reviewEvidence.tool.git.sha256 !== expectedGitSha256
  ) {
    throw new Error("Bundled CLI report is not bound to the exact Git executable.");
  }
  const verifiedSignature = await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "verify-signature",
      "--report",
      ".agentship/reviews/signed.json",
      "--signature",
      ".agentship/reviews/signed.sig.json",
      "--public-key",
      publicKeyPath,
    ],
    { cwd: reviewRepository, encoding: "utf8" }
  );
  if (!verifiedSignature.stdout.includes("AgentShip signature: VALID")) {
    throw new Error("Bundled CLI did not verify detached signature evidence.");
  }
  console.log("Bundled CLI init, ci-init, doctor, review, benchmark, leaderboard, outcome, metrics, and signature commands run outside the repository without node_modules.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
