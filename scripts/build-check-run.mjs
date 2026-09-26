import { open, realpath, writeFile } from "node:fs/promises";
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
  if (!Array.isArray(report.findings) || report.findings.length > MAX_FINDINGS) {
    throw new Error(`AgentShip report findings must contain at most ${MAX_FINDINGS} entries.`);
  }
  for (let index = 0; index < report.findings.length; index++) {
    objectField(report.findings[index], `AgentShip report findings[${index}]`);
  }
  const reportRunId = boundedString(report.runId, "AgentShip report runId", 128);

  return {
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
        `- Source workflow run: ${runId}`,
        "",
        "Download the workflow artifact for the bounded JSON, Markdown, and SARIF evidence. This Check Run is always neutral and is not a merge gate.",
      ].join("\n"),
    },
  };
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
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
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
  const [eventPath, reportPath, outputPath] = process.argv.slice(2);
  if (!eventPath || !reportPath || !outputPath || process.argv.length !== 5) {
    throw new Error("Usage: node scripts/build-check-run.mjs <event.json> <report.json> <output.json>");
  }
  const payload = await buildCheckRunPayload({
    eventPath,
    reportPath,
    expectedRepository: process.env.GITHUB_REPOSITORY,
    artifactRoot: process.env.AGENTSHIP_ARTIFACT_ROOT,
  });
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
