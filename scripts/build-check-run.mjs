import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_FINDINGS = 10_000;

export async function buildCheckRunPayload(options) {
  const event = await readJsonFile(options.eventPath, MAX_EVENT_BYTES, "Workflow event");
  const report = await readJsonFile(
    options.reportPath,
    MAX_REPORT_BYTES,
    "AgentShip report",
    options.artifactRoot
  );
  const workflowRun = objectField(event.workflow_run, "Workflow event workflow_run");
  if (
    event.action !== "completed" ||
    workflowRun.status !== "completed" ||
    workflowRun.name !== "AgentShip report" ||
    workflowRun.event !== "pull_request"
  ) {
    throw new Error("Check publication requires a completed AgentShip report pull_request run.");
  }
  if (!Array.isArray(workflowRun.pull_requests) || workflowRun.pull_requests.length !== 1) {
    throw new Error("Workflow run must identify exactly one pull request.");
  }
  const pullRequest = objectField(workflowRun.pull_requests[0], "Workflow run pull request");
  const head = objectField(pullRequest.head, "Workflow run pull request head");
  const base = objectField(pullRequest.base, "Workflow run pull request base");
  const repository = objectField(event.repository, "Workflow event repository");
  const owner = objectField(repository.owner, "Workflow event repository owner");
  const ownerLogin = boundedString(owner.login, "Workflow event repository owner login", 128);
  const repositoryName = boundedString(repository.name, "Workflow event repository name", 128);
  const fullName = boundedString(repository.full_name, "Workflow event repository full_name", 257);
  if (fullName !== `${ownerLogin}/${repositoryName}`) {
    throw new Error("Workflow event repository identity is inconsistent.");
  }
  if (options.expectedRepository && fullName !== options.expectedRepository) {
    throw new Error("Workflow event repository does not match GITHUB_REPOSITORY.");
  }

  const headSha = gitObjectId(head.sha, "Workflow run pull request head SHA");
  const baseSha = gitObjectId(base.sha, "Workflow run pull request base SHA");
  const pullNumber = positiveInteger(pullRequest.number, "Workflow run pull request number");
  const runId = positiveInteger(workflowRun.id, "Workflow run id");
  const detailsUrl = boundedHttpsUrl(workflowRun.html_url, "Workflow run URL");

  if (report.schemaVersion !== 1) {
    throw new Error("AgentShip report must declare schemaVersion: 1.");
  }
  const reportTool = objectField(report.tool, "AgentShip report tool");
  if (boundedString(reportTool.name, "AgentShip report tool name", 128) !== "AgentShip Verify") {
    throw new Error("AgentShip report tool name is invalid.");
  }
  boundedString(reportTool.version, "AgentShip report tool version", 64);
  const git = objectField(reportTool.git, "AgentShip report tool Git");
  boundedString(git.executable, "AgentShip report tool Git executable", 4096);
  boundedString(git.version, "AgentShip report tool Git version", 160);
  const gitBytes = positiveInteger(git.bytes, "AgentShip report tool Git bytes");
  if (gitBytes > 128 * 1024 * 1024) {
    throw new Error("AgentShip report tool Git exceeds 134217728 bytes.");
  }
  const gitSha256 = sha256String(
    git.sha256,
    "AgentShip report tool Git SHA-256"
  );
  const verifier = objectField(
    reportTool.verifier,
    "AgentShip report tool verifier"
  );
  boundedString(
    verifier.entrypoint,
    "AgentShip report tool verifier entrypoint",
    4096
  );
  const verifierBytes = positiveInteger(
    verifier.bytes,
    "AgentShip report tool verifier bytes"
  );
  if (verifierBytes > 32 * 1024 * 1024) {
    throw new Error("AgentShip report tool verifier exceeds 33554432 bytes.");
  }
  const verifierSha256 = sha256String(
    verifier.sha256,
    "AgentShip report tool verifier SHA-256"
  );
  const runner = objectField(report.runner, "AgentShip report runner");
  const runnerPlatform = boundedString(
    runner.platform,
    "AgentShip report runner platform",
    32
  );
  if (runnerPlatform !== "linux") {
    throw new Error("AgentShip CI report runner platform must be linux.");
  }
  boundedString(runner.architecture, "AgentShip report runner architecture", 64);
  boundedString(runner.kernelRelease, "AgentShip report runner kernel release", 256);
  const osRelease = objectField(
    runner.osRelease,
    "AgentShip report runner OS release"
  );
  const osPrettyName = boundedString(
    osRelease.prettyName ?? osRelease.id,
    "AgentShip report runner OS release identity",
    256
  );
  sha256String(
    osRelease.sha256,
    "AgentShip report runner OS release SHA-256"
  );
  const node = objectField(runner.node, "AgentShip report runner Node");
  const nodeVersion = boundedString(
    node.version,
    "AgentShip report runner Node version",
    64
  );
  boundedString(
    node.executable,
    "AgentShip report runner Node executable",
    4096
  );
  const nodeBytes = positiveInteger(
    node.bytes,
    "AgentShip report runner Node bytes"
  );
  if (nodeBytes > 256 * 1024 * 1024) {
    throw new Error("AgentShip report runner Node exceeds 268435456 bytes.");
  }
  const nodeSha256 = sha256String(
    node.sha256,
    "AgentShip report runner Node SHA-256"
  );
  const githubRunner = objectField(
    runner.github,
    "AgentShip report GitHub runner"
  );
  if (
    boundedString(
      githubRunner.environment,
      "AgentShip report GitHub runner environment",
      256
    ) !== "github-hosted" ||
    boundedString(
      githubRunner.runnerOs,
      "AgentShip report GitHub runner OS",
      256
    ) !== "Linux" ||
    boundedString(
      githubRunner.runnerArch,
      "AgentShip report GitHub runner architecture",
      256
    ) !== "X64"
  ) {
    throw new Error("AgentShip report must claim the expected GitHub-hosted Linux X64 runner.");
  }
  const imageOs = boundedString(
    githubRunner.imageOs,
    "AgentShip report GitHub image OS",
    256
  );
  const imageVersion = boundedString(
    githubRunner.imageVersion,
    "AgentShip report GitHub image version",
    256
  );
  const verdict = report.verdict;
  if (verdict !== "PASS" && verdict !== "WARN" && verdict !== "BLOCK") {
    throw new Error("AgentShip report verdict is invalid.");
  }
  const reportRepository = objectField(report.repository, "AgentShip report repository");
  const reportBase = gitObjectId(reportRepository.base, "AgentShip report repository base");
  if (reportBase !== baseSha) {
    throw new Error("AgentShip report base does not match the pull request base.");
  }
  const reviewedCommit = gitObjectId(reportRepository.head, "AgentShip report repository head");
  if (reportRepository.reviewScope !== "base") {
    throw new Error("AgentShip CI report must use base review scope.");
  }
  sha256String(reportRepository.diffSha256, "AgentShip report diff SHA-256");
  const reportConfiguration = objectField(
    report.configuration,
    "AgentShip report configuration"
  );
  sha256String(reportConfiguration.sha256, "AgentShip report configuration SHA-256");
  if (report.task !== undefined) {
    const reportTask = objectField(report.task, "AgentShip report task");
    sha256String(reportTask.sha256, "AgentShip report task SHA-256");
  }
  if (!Array.isArray(report.findings) || report.findings.length > MAX_FINDINGS) {
    throw new Error(`AgentShip report findings must contain at most ${MAX_FINDINGS} entries.`);
  }
  for (let index = 0; index < report.findings.length; index++) {
    objectField(report.findings[index], `AgentShip report findings[${index}]`);
  }
  const reportRunId = boundedString(report.runId, "AgentShip report runId", 128);

  const payload = {
    owner: ownerLogin,
    repo: repositoryName,
    name: "AgentShip evidence report",
    head_sha: headSha,
    status: "completed",
    conclusion: "neutral",
    details_url: detailsUrl,
    output: {
      title: `AgentShip report: ${verdict}`,
      summary: [
        `AgentShip produced a non-blocking **${verdict}** evidence report for pull request #${pullNumber}.`,
        "",
        `- Findings: ${report.findings.length}`,
        `- Report run: \`${reportRunId}\``,
        `- Reviewed checkout: \`${reviewedCommit}\``,
        `- Git SHA-256: \`${gitSha256}\``,
        `- Verifier SHA-256: \`${verifierSha256}\``,
        `- Runner image: \`${imageOs}/${imageVersion}\``,
        `- Runner OS: \`${osPrettyName}\``,
        `- Node: \`${nodeVersion}\` (SHA-256 \`${nodeSha256}\`)`,
        `- Source workflow run: ${runId}`,
        "",
        "Download the workflow artifact for the bounded JSON, Markdown, and SARIF evidence. This Check Run is always neutral and is not a merge gate.",
      ].join("\n"),
    },
  };
  if (Boolean(options.historyReportPath) !== Boolean(options.historyRoot)) {
    throw new Error("History output requires both historyReportPath and historyRoot.");
  }
  if (options.historyReportPath && options.historyRoot) {
    await writeValidatedHistoryReport(
      report,
      options.historyReportPath,
      options.historyRoot
    );
  }
  return payload;
}

async function writeValidatedHistoryReport(report, outputPath, historyRoot) {
  await mkdir(historyRoot, { recursive: true, mode: 0o700 });
  const resolvedRoot = await realpath(historyRoot);
  const absoluteOutput = path.resolve(outputPath);
  const relative = path.relative(resolvedRoot, absoluteOutput);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("History report output must stay inside the history directory.");
  }
  const handle = await open(absoluteOutput, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

async function readJsonFile(filePath, maxBytes, label, requiredRoot) {
  const resolvedPath = await realpath(filePath);
  if (requiredRoot) {
    const resolvedRoot = await realpath(requiredRoot);
    const relative = path.relative(resolvedRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${label} must stay inside the artifact directory.`);
    }
  }
  const handle = await open(resolvedPath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
    if (stats.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    const source = await handle.readFile();
    if (source.length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    let value;
    try {
      value = JSON.parse(source.toString("utf8"));
    } catch {
      throw new Error(`${label} must contain valid JSON.`);
    }
    return objectField(value, label);
  } finally {
    await handle.close();
  }
}

function objectField(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function boundedString(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    throw new Error(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return value;
}

function gitObjectId(value, field) {
  const candidate = boundedString(value, field, 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(candidate)) {
    throw new Error(`${field} must be a lowercase Git object ID.`);
  }
  return candidate;
}

function sha256String(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer.`);
  return value;
}

function boundedHttpsUrl(value, field) {
  const candidate = boundedString(value, field, 2048);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${field} must be a credential-free HTTPS URL.`);
  }
  return candidate;
}

async function main() {
  const [eventPath, reportPath, outputPath, historyReportPath] = process.argv.slice(2);
  if (!eventPath || !reportPath || !outputPath || process.argv.length < 5 || process.argv.length > 6) {
    throw new Error("Usage: node scripts/build-check-run.mjs <event.json> <report.json> <output.json> [history.json]");
  }
  const payload = await buildCheckRunPayload({
    eventPath,
    reportPath,
    expectedRepository: process.env.GITHUB_REPOSITORY,
    artifactRoot: process.env.AGENTSHIP_ARTIFACT_ROOT,
    ...(historyReportPath
      ? {
          historyReportPath,
          historyRoot: process.env.AGENTSHIP_HISTORY_ROOT,
        }
      : {}),
  });
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
