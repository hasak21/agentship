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
const isolatedCliCommand = "./agentship.cjs";
const intentFixture = path.resolve("fixtures/intent/executable-patch-corpus.json");

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  await copyFile(path.resolve("dist/agentship.cjs"), isolatedCli);
  const { stdout } = await execFileAsync(process.execPath, [isolatedCliCommand, "review", "--help"], {
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
    "agentship missed",
    "agentship missed-audit",
    "agentship outcome-metrics",
    "agentship metrics",
    "agentship leaderboard",
    "agentship import-swebench",
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
    [isolatedCliCommand, "benchmark", "--fixtures", intentFixture],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const report = JSON.parse(benchmark.stdout);
  if (
    report.schemaVersion !== 1 ||
    report.corpus.kind !== "executable_patch" ||
    report.corpus.labelSemantics !== "file_oracle_omission" ||
    report.corpus.cases !== 12
  ) {
    throw new Error("Bundled CLI benchmark output is incomplete.");
  }
  const importedCorpusDirectory = path.join(temporaryDirectory, "swebench-import");
  const importedLogsDirectory = path.join(importedCorpusDirectory, "logs", "project__repo-1");
  await mkdir(importedLogsDirectory, { recursive: true });
  await writeFile(
    path.join(importedCorpusDirectory, "dataset.jsonl"),
    `${JSON.stringify({
      instance_id: "project__repo-1",
      repo: "project/repo",
      base_commit: "a".repeat(40),
      problem_statement: "Update the behavior and add regression coverage.",
    })}\n`
  );
  await writeFile(
    path.join(importedCorpusDirectory, "predictions.jsonl"),
    `${JSON.stringify({
      instance_id: "project__repo-1",
      model_name_or_path: "standalone-model",
      model_patch: "diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1 @@\n-old\n+new\n",
    })}\n`
  );
  await writeFile(
    path.join(importedLogsDirectory, "report.json"),
    `${JSON.stringify({ "project__repo-1": { resolved: false, infra_failure: false } })}\n`
  );
  await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "import-swebench",
      "--dataset",
      "dataset.jsonl",
      "--predictions",
      "predictions.jsonl",
      "--reports",
      "logs",
      "--output",
      "corpus.json",
      "--candidate-run",
      "standalone-run",
      "--evidence-base-url",
      `https://github.com/example/results/blob/${"b".repeat(40)}/`,
      "--dataset-name",
      "SWE-bench/SWE-bench_Verified",
      "--dataset-revision",
      "c".repeat(40),
      "--split",
      "test",
      "--source-url",
      "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
      "--selection",
      "Every prediction in this parser fixture.",
      "--retrieved-at",
      "2026-10-10",
    ],
    { cwd: importedCorpusDirectory, encoding: "utf8" }
  );
  const importedCorpus = JSON.parse(
    await readFile(path.join(importedCorpusDirectory, "corpus.json"), "utf8")
  );
  if (
    importedCorpus.kind !== "external_evaluation" ||
    importedCorpus.cases?.[0]?.source?.predictionSha256?.length !== 64 ||
    importedCorpus.cases?.[0]?.source?.outcomeSha256?.length !== 64
  ) {
    throw new Error("Bundled CLI SWE-bench import output is incomplete.");
  }
  const importedBenchmarkRun = await execFileAsync(
    process.execPath,
    [isolatedCli, "benchmark", "--fixtures", "corpus.json"],
    { cwd: importedCorpusDirectory, encoding: "utf8" }
  );
  const importedBenchmark = JSON.parse(importedBenchmarkRun.stdout);
  if (
    importedBenchmark.corpus?.kind !== "external_evaluation" ||
    importedBenchmark.corpus?.labelSemantics !== "task_resolution_proxy" ||
    importedBenchmark.corpus?.cases !== 1 ||
    importedBenchmark.results?.[0]?.source?.instanceId !== "project__repo-1"
  ) {
    throw new Error("Bundled CLI could not benchmark its imported SWE-bench corpus.");
  }
  const initializedRepository = path.join(temporaryDirectory, "initialized");
  const reviewPacketPath = path.join(importedCorpusDirectory, "review.json");
  await execFileAsync(process.execPath, [isolatedCli, "adjudication-init", "--fixtures", "corpus.json", "--output", "review.json"], {
    cwd: importedCorpusDirectory,
  });
  const reviewPacket = JSON.parse(await readFile(reviewPacketPath, "utf8"));
  if (reviewPacket.reviewer !== "" || reviewPacket.cases[0].decision !== "unreviewed" || "omissionExpected" in reviewPacket.cases[0] || "source" in reviewPacket.cases[0]) {
    throw new Error("Bundled CLI did not prepare a blinded, unreviewed packet.");
  }
  for (const args of [
    ["adjudication-init", "--fixtures", "corpus.json", "--output", "review.json"],
    ["benchmark", "--fixtures", "corpus.json", "--adjudications", "review.json"],
  ]) {
    let rejected = false;
    try { await execFileAsync(process.execPath, [isolatedCli, ...args], { cwd: importedCorpusDirectory }); }
    catch { rejected = true; }
    if (!rejected) throw new Error("Bundled CLI accepted overwrite or unreviewed labels.");
  }
  reviewPacket.reviewer = "Synthetic CLI test; not an independent human review";
  Object.assign(reviewPacket.cases[0], {
    decision: "omission", rationale: "Synthetic omission assertion", evidence: ["fixture:patch"],
  });
  await writeFile(reviewPacketPath, JSON.stringify(reviewPacket));
  const reviewedRun = await execFileAsync(process.execPath, [isolatedCli, "benchmark", "--fixtures", "corpus.json", "--adjudications", "review.json"], {
    cwd: importedCorpusDirectory, encoding: "utf8",
  });
  const reviewedBenchmark = JSON.parse(reviewedRun.stdout);
  if (reviewedBenchmark.corpus.labelSemantics !== "reviewer_asserted_omission" || reviewedBenchmark.corpus.adjudication.decided !== 1) {
    throw new Error("Bundled CLI lost explicit reviewer labels or coverage.");
  }
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
      isolatedCliCommand,
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
  const missed = await execFileAsync(
    process.execPath,
    [
      isolatedCliCommand,
      "missed",
      "--report", "reports/report.json",
      "--finding-id", "standalone-missed",
      "--finding-kind", "missing_test",
      "--severity", "warning",
      "--title", "Required test was missed",
      "--actor", "cli-verifier",
      "--reason", "Independent CLI verification label.",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  if (!missed.stdout.includes("AgentShip missed finding: recorded")) {
    throw new Error("Bundled CLI missed-finding output is incomplete.");
  }
  const audit = await execFileAsync(
    process.execPath,
    [
      isolatedCliCommand,
      "missed-audit",
      "--report", "reports/report.json",
      "--actor", "cli-verifier",
      "--reason", "Completed audit of this review report.",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  if (!audit.stdout.includes("Labels: 1")) {
    throw new Error("Bundled CLI missed-audit output is incomplete.");
  }
  const measured = await execFileAsync(
    process.execPath,
    [
      isolatedCliCommand,
      "outcome-metrics",
      "--outcomes",
      ".agentship/outcomes",
      "--reports",
      "reports",
      "--missed-findings",
      ".agentship/missed-findings",
      "--missed-audits",
      ".agentship/missed-audits",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const outcomeMetrics = JSON.parse(measured.stdout);
  if (
    outcomeMetrics.outcomes !== 1 ||
    outcomeMetrics.dispositions.precision !== 1 ||
    outcomeMetrics.reviewCorpus.falseBlocksPer100Reviews !== 0 ||
    outcomeMetrics.recall.recall !== 0.5
  ) {
    throw new Error("Bundled CLI outcome metrics are incomplete.");
  }
  await copyFile(intentFixture, path.join(temporaryDirectory, "corpus.json"));
  const calibration = await execFileAsync(
    process.execPath,
    [
      isolatedCliCommand,
      "metrics",
      "--outcomes", ".agentship/outcomes",
      "--reports", "reports",
      "--benchmark-fixtures", "corpus.json",
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
  const proxyCalibrationRun = await execFileAsync(
    process.execPath,
    [
      isolatedCliCommand,
      "metrics",
      "--outcomes", ".agentship/outcomes",
      "--reports", "reports",
      "--benchmark-fixtures", "swebench-import/corpus.json",
    ],
    { cwd: temporaryDirectory, encoding: "utf8" }
  );
  const proxyCalibration = JSON.parse(proxyCalibrationRun.stdout);
  if (
    proxyCalibration.inputs.benchmark.labelSemantics !== "task_resolution_proxy" ||
    proxyCalibration.recall.labelSemantics !== "task_resolution_proxy" ||
    proxyCalibration.recall.omissions !== null ||
    proxyCalibration.recall.taskResolutionProxy !== importedBenchmark.metrics.recall
  ) {
    throw new Error("Bundled CLI conflated task-resolution proxies with omission recall.");
  }
  const leaderboardDirectory = path.join(temporaryDirectory, "leaderboard");
  const reviewedMetricsRun = await execFileAsync(process.execPath, [isolatedCliCommand, "metrics",
    "--outcomes", ".agentship/outcomes", "--reports", "reports",
    "--benchmark-fixtures", "swebench-import/corpus.json", "--adjudications", "swebench-import/review.json",
  ], { cwd: temporaryDirectory, encoding: "utf8" });
  const reviewedMetrics = JSON.parse(reviewedMetricsRun.stdout);
  if (reviewedMetrics.recall.labelSemantics !== "reviewer_asserted_omission" ||
    reviewedMetrics.recall.taskResolutionProxy !== null ||
    reviewedMetrics.inputs.benchmark.adjudication.decided !== 1 ||
    reviewedMetrics.recall.omissions !== reviewedBenchmark.metrics.recall) {
    throw new Error("Calibration failed to retain reviewer-label evidence semantics.");
  }
  await mkdir(leaderboardDirectory);
  const leaderboardTaskSha = createHash("sha256").update("task").digest("hex");
  const leaderboardSuiteSha = createHash("sha256").update("suite").digest("hex");
  const leaderboardReport = `${JSON.stringify({
    schemaVersion: 1,
    verdict: "PASS",
    task: { sha256: leaderboardTaskSha },
    configuration: { sha256: createHash("sha256").update("standalone-policy").digest("hex") },
    repository: { reviewScope: "working-tree" },
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
  if (leaderboard.submissions?.[0]?.metrics?.passRate !== 1 || leaderboard.suite?.reviewContexts?.[0]?.reviewScope !== "working-tree") {
    throw new Error("Bundled CLI leaderboard output is incomplete.");
  }
  const incomparableReport = JSON.parse(leaderboardReport);
  incomparableReport.configuration.sha256 = createHash("sha256").update("weaker-policy").digest("hex");
  const incomparableBytes = JSON.stringify(incomparableReport);
  await writeFile(path.join(leaderboardDirectory, "weaker.json"), incomparableBytes);
  const incomparableManifest = JSON.parse(await readFile(path.join(leaderboardDirectory, "agent.submission.json"), "utf8"));
  incomparableManifest.submissionId = "weaker-agent";
  incomparableManifest.tasks[0].report = "weaker.json";
  incomparableManifest.tasks[0].reportSha256 = createHash("sha256").update(incomparableBytes).digest("hex");
  const incomparableManifestPath = path.join(leaderboardDirectory, "weaker.submission.json");
  await writeFile(incomparableManifestPath, JSON.stringify(incomparableManifest));
  let incomparableRankingRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "leaderboard", "--submissions", leaderboardDirectory], { cwd: temporaryDirectory });
  } catch (error) {
    incomparableRankingRejected = error.code === 2 && error.stderr.includes("same review policy and scope");
  }
  if (!incomparableRankingRejected) throw new Error("Bundled CLI ranked reports produced under different policies.");
  await rm(incomparableManifestPath);
  const contradictoryReport = JSON.parse(leaderboardReport);
  contradictoryReport.findings = [{ id: "block", kind: "required_check_failed", severity: "blocker" }];
  const contradictoryBytes = JSON.stringify(contradictoryReport);
  await writeFile(path.join(leaderboardDirectory, "report.json"), contradictoryBytes);
  const contradictoryManifestPath = path.join(leaderboardDirectory, "agent.submission.json");
  const contradictoryManifest = JSON.parse(await readFile(contradictoryManifestPath, "utf8"));
  contradictoryManifest.tasks[0].reportSha256 = createHash("sha256").update(contradictoryBytes).digest("hex");
  await writeFile(contradictoryManifestPath, JSON.stringify(contradictoryManifest));
  let contradictoryRankingRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "leaderboard", "--submissions", leaderboardDirectory], { cwd: temporaryDirectory });
  } catch (error) {
    contradictoryRankingRejected = error.code === 2 && error.stderr.includes("inconsistent verdict");
  }
  if (!contradictoryRankingRejected) throw new Error("Bundled CLI ranked a PASS report containing an active blocker.");

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
  await writeFile(path.join(reviewRepository, "subject.txt"), "updated subject\n");
  await writeFile(path.join(reviewRepository, "task.md"), [
    "## Requirements",
    "1. Update `change:subject.txt`.",
    "   - Add regression tests in `change:tests/regression.test.ts`.",
    "   Pass `check:smoke`.",
    "",
  ].join("\n"));
  await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md", "--output", ".agentship/reviews/wrapped.json"], {
    cwd: reviewRepository,
  });
  const wrappedReview = JSON.parse(await readFile(path.join(reviewRepository, ".agentship/reviews/wrapped.json"), "utf8"));
  const wrappedMapping = wrappedReview.task?.mappings?.[0];
  if (wrappedReview.task?.requirements?.length !== 1 || wrappedMapping?.status !== "missing" ||
      JSON.stringify(wrappedMapping.missingReferences) !== JSON.stringify(["tests/regression.test.ts"]) ||
      wrappedMapping.checkEvidence?.[0]?.status !== "passed") {
    throw new Error("Bundled CLI dropped a wrapped test requirement despite passing smoke evidence.");
  }
  await writeFile(path.join(reviewRepository, "task.md"), "## Requirements\n1. Update `change:Dockerfile` and `change:src/my file.ts`.\n");
  await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md", "--output", ".agentship/reviews/explicit-paths.json"], {
    cwd: reviewRepository,
  });
  const explicitPaths = JSON.parse(await readFile(path.join(reviewRepository, ".agentship/reviews/explicit-paths.json"), "utf8"));
  if (JSON.stringify(explicitPaths.task?.mappings?.[0]?.missingReferences) !== JSON.stringify(["Dockerfile", "src/my file.ts"])) {
    throw new Error("Bundled CLI silently ignored root or space-containing explicit paths.");
  }
  const quotedPath = 'src/会话 "name".ts';
  await mkdir(path.join(reviewRepository, "src"), { recursive: true });
  await writeFile(path.join(reviewRepository, quotedPath), "export function handler() { return 0; }\n");
  await execFileAsync("git", ["add", "--", quotedPath], { cwd: reviewRepository });
  await execFileAsync("git", ["commit", "-qm", "quoted path baseline"], { cwd: reviewRepository });
  await writeFile(path.join(reviewRepository, quotedPath), "export function handler() { return 1; }\n");
  await writeFile(path.join(reviewRepository, "task.md"), `## Requirements\n1. Update \`symbol:${quotedPath}#handler\`.\n`);
  await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md", "--output", ".agentship/reviews/quoted-path.json"], {
    cwd: reviewRepository,
  });
  const quotedReview = JSON.parse(await readFile(path.join(reviewRepository, ".agentship/reviews/quoted-path.json"), "utf8"));
  if (quotedReview.task?.mappings?.[0]?.symbolEvidence?.[0]?.status !== "changed") {
    throw new Error("Bundled CLI lost symbol evidence in a Git-quoted UTF-8 path.");
  }
  let dirtyBaseRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "review", "--base", "HEAD", "--output", ".agentship/reviews/dirty-base.json"], { cwd: reviewRepository });
  } catch (error) {
    dirtyBaseRejected = error.code === 2 && error.stderr.includes("Base review requires clean tracked state");
  }
  if (!dirtyBaseRejected) throw new Error("Bundled CLI reviewed committed diffs against dirty tracked source.");
  await execFileAsync("git", ["add", "--", "subject.txt", quotedPath], { cwd: reviewRepository });
  await execFileAsync("git", ["commit", "-qm", "clean committed-base fixture"], { cwd: reviewRepository });
  await execFileAsync(process.execPath, [isolatedCli, "review", "--base", "HEAD", "--output", ".agentship/reviews/pinned-base.json"], { cwd: reviewRepository });
  const pinnedBaseReview = JSON.parse(await readFile(path.join(reviewRepository, ".agentship/reviews/pinned-base.json"), "utf8"));
  const expectedBase = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: reviewRepository })).stdout.trim();
  if (pinnedBaseReview.repository.baseCommit !== expectedBase || pinnedBaseReview.repository.baseReferenceCommit !== expectedBase || pinnedBaseReview.repository.postCheckBaseReferenceCommit !== expectedBase) {
    throw new Error("Bundled CLI did not retain the exact resolved base commit identity.");
  }
  if (pinnedBaseReview.repository.postCheckTrackedState?.dirtyFiles?.length !== 0 || pinnedBaseReview.repository.postCheckTrackedState?.hiddenFiles?.length !== 0) {
    throw new Error("Bundled CLI did not record clean post-check tracked state.");
  }
  await writeFile(path.join(reviewRepository, "task.md"), "## Requirements\n1. Pass `check:`.\n");
  let invalidAnnotationRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md"], { cwd: reviewRepository });
  } catch (error) {
    invalidAnnotationRejected = error.code === 2 && error.stderr.includes("Task requirement 'R1': Invalid check");
  }
  if (!invalidAnnotationRejected) throw new Error("Bundled CLI accepted an empty explicit check annotation.");
  await writeFile(path.join(reviewRepository, "task.md"), "<!-- agentship: strict-change-coverage -->\n## Requirements\n1. Update API.\n```markdown\n2. Add regression tests.\n");
  let unclosedFenceRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md", "--output", ".agentship/reviews/unclosed-fence.json"], { cwd: reviewRepository });
  } catch (error) {
    unclosedFenceRejected = error.code === 2 && error.stderr.includes("Unclosed task code fence at line 4");
  }
  if (!unclosedFenceRejected) throw new Error("Bundled CLI silently accepted a task with an unclosed fence.");
  try {
    await stat(path.join(reviewRepository, ".agentship/reviews/unclosed-fence.json"));
    throw new Error("Bundled CLI published a review despite invalid task fence syntax.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(path.join(reviewRepository, "task.md"), Buffer.concat([
    Buffer.from("## Requirements\n1. Change `change:"), Buffer.from([0xff]), Buffer.from(".ts`.\n"),
  ]));
  let invalidTaskEncodingRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md", "--output", ".agentship/reviews/invalid-encoding.json"], { cwd: reviewRepository });
  } catch (error) {
    invalidTaskEncodingRejected = error.code === 2 && error.stderr.includes("Task document must contain valid UTF-8");
  }
  if (!invalidTaskEncodingRejected) throw new Error("Bundled CLI accepted replacement-decoded task requirements.");
  try {
    await stat(path.join(reviewRepository, ".agentship/reviews/invalid-encoding.json"));
    throw new Error("Bundled CLI published a review despite invalid task encoding.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Invalid policy encoding must fail before executing even the first check.
  await writeFile(path.join(reviewRepository, "task.md"), "## Requirements\n1. Update API.\n");
  await writeFile(path.join(reviewRepository, ".agentship.yml"), Buffer.concat([
    Buffer.from('version: 1\nmode: report\nchecks:\n  - name: smoke\n    run: node -e "require(\'fs\').writeFileSync(\'must-not-run\', \'marker\')"\n# '),
    Buffer.from([0xff]), Buffer.from("\n"),
  ]));
  let invalidConfigurationRejected = false;
  try {
    await execFileAsync(process.execPath, [isolatedCli, "review", "--task", "task.md"], { cwd: reviewRepository });
  } catch (error) {
    invalidConfigurationRejected = error.code === 2 && error.stderr.includes("AgentShip configuration must contain valid UTF-8");
  }
  if (!invalidConfigurationRejected) throw new Error("Bundled CLI accepted invalid configuration encoding.");
  try {
    await stat(path.join(reviewRepository, "must-not-run"));
    throw new Error("Bundled CLI executed a check despite invalid configuration encoding.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log("Bundled CLI init, ci-init, doctor, review, benchmark, SWE-bench import, leaderboard, outcome, missed, missed-audit, outcome-metrics, metrics, and signature commands run outside the repository without node_modules.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
