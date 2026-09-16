import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { collectGitEvidence, getHead, resolveRepositoryRoot } from "./git";
import { runCheck } from "./runner";
import {
  applyRequirementConfirmations,
  parseTaskRequirements,
} from "./task-parser";
import {
  mapRequirementsToChangedFiles,
  summarizeChangeCoverage,
  type RequirementMapping,
} from "./requirement-mapper";
import type { CheckEvidence, ReviewFinding, ReviewReport, ReviewVerdict } from "./types";

export interface RunReviewOptions {
  cwd: string;
  configPath?: string;
  taskPath?: string;
  base?: string;
  staged?: boolean;
  outputPath?: string;
  confirmedRequirementIds?: string[];
}

export async function runReview(options: RunReviewOptions): Promise<{
  report: ReviewReport;
  jsonPath: string;
  markdownPath: string;
}> {
  const started = Date.now();
  const repositoryRoot = await resolveRepositoryRoot(options.cwd);
  const { config, absolutePath: configPath, source: configSource } = await loadConfig(
    repositoryRoot,
    options.configPath
  );
  const gitEvidence = await collectGitEvidence(repositoryRoot, {
    staged: options.staged ?? false,
    base: options.base,
  });
  const head = await getHead(repositoryRoot);
  const diffSha256 = sha256(gitEvidence.diff);

  const task = options.taskPath
    ? await loadTask(repositoryRoot, options.taskPath)
    : undefined;
  if (task) {
    task.requirements = applyRequirementConfirmations(
      task.requirements,
      options.confirmedRequirementIds ?? []
    );
    task.mappings = mapRequirementsToChangedFiles(
      task.requirements,
      gitEvidence.changedFiles
    );
    task.changeCoverage = summarizeChangeCoverage(
      task.mappings,
      gitEvidence.changedFiles
    );
  }

  const checks: CheckEvidence[] = [];
  for (const check of config.checks) {
    checks.push(await runCheck(check, repositoryRoot));
  }

  const postCheckGitEvidence = await collectGitEvidence(repositoryRoot, {
    staged: options.staged ?? false,
    base: options.base,
  });
  const postCheckHead = await getHead(repositoryRoot);
  const postCheckDiffSha256 = sha256(postCheckGitEvidence.diff);
  const stableDuringChecks =
    head === postCheckHead && diffSha256 === postCheckDiffSha256;
  const findings = buildFindings(
    checks,
    {
      stable: stableDuringChecks,
      beforeHead: head,
      afterHead: postCheckHead,
      beforeDiffSha256: diffSha256,
      afterDiffSha256: postCheckDiffSha256,
    },
    task?.mappings,
    task?.requirements
  );
  const verdict = calculateVerdict(findings);
  const finished = Date.now();
  const runId = randomUUID();
  const report: ReviewReport = {
    schemaVersion: 1,
    runId,
    tool: { name: "AgentShip Verify", version: "0.1.0" },
    mode: config.mode,
    verdict,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    repository: {
      root: repositoryRoot,
      head,
      postCheckHead,
      base: options.base,
      reviewScope: gitEvidence.scope,
      diffSha256,
      postCheckDiffSha256,
      stableDuringChecks,
      changedFiles: gitEvidence.changedFiles,
    },
    task,
    configuration: {
      path: path.relative(repositoryRoot, configPath),
      sha256: sha256(configSource),
    },
    checks,
    findings,
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      failed: checks.filter((check) => check.status === "failed").length,
      timedOut: checks.filter((check) => check.status === "timed_out").length,
    },
  };

  const jsonPath = path.resolve(
    repositoryRoot,
    options.outputPath ?? `.agentship/reviews/${runId}.json`
  );
  const markdownPath = jsonPath.replace(/\.json$/i, ".md");
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderMarkdown(report), "utf8"),
  ]);

  return { report, jsonPath, markdownPath };
}

export function buildFindings(
  checks: CheckEvidence[],
  repository?: {
    stable: boolean;
    beforeHead: string;
    afterHead: string;
    beforeDiffSha256: string;
    afterDiffSha256: string;
  },
  mappings: Array<{
    requirementId: string;
    status: "observed" | "missing" | "unmapped";
    references: string[];
  }> = [],
  requirements: Array<{
    id: string;
    confirmation: "not_required" | "required" | "confirmed";
  }> = []
): ReviewFinding[] {
  const findings = checks.flatMap((check, index): ReviewFinding[] => {
    if (check.status === "passed") return [];
    const required = check.required;
    const kind = required
      ? check.status === "timed_out"
        ? "required_check_timed_out"
        : "required_check_failed"
      : "optional_check_failed";
    return [
      {
        id: `check-${index + 1}`,
        severity: required ? "blocker" : "warning",
        kind,
        title: `${required ? "Required" : "Optional"} check '${check.name}' ${
          check.status === "timed_out" ? "timed out" : "failed"
        }`,
        evidence: {
          check: check.name,
          command: check.command,
          exitCode: check.exitCode,
        },
      },
    ];
  });

  if (repository && !repository.stable) {
    findings.push({
      id: "repository-state",
      severity: "blocker",
      kind: "repository_changed_during_review",
      title: "Repository state changed while verification checks were running",
      evidence: {
        beforeHead: repository.beforeHead,
        afterHead: repository.afterHead,
        beforeDiffSha256: repository.beforeDiffSha256,
        afterDiffSha256: repository.afterDiffSha256,
      },
    });
  }

  for (const mapping of mappings) {
    if (mapping.status !== "missing") continue;
    findings.push({
      id: `requirement-${mapping.requirementId}`,
      severity: "warning",
      kind: "explicit_requirement_path_unchanged",
      title: `${mapping.requirementId} names repository paths absent from the reviewed change`,
      evidence: {
        requirementId: mapping.requirementId,
        expectedPaths: mapping.references,
      },
    });
  }

  for (const requirement of requirements) {
    if (requirement.confirmation !== "required") continue;
    findings.push({
      id: `confirmation-${requirement.id}`,
      severity: "blocker",
      kind: "requirement_confirmation_missing",
      title: `${requirement.id} requires explicit operator confirmation`,
      evidence: { requirementId: requirement.id },
    });
  }

  return findings;
}

export function calculateVerdict(findings: ReviewFinding[]): ReviewVerdict {
  if (findings.some((finding) => finding.severity === "blocker")) return "BLOCK";
  if (findings.length > 0) return "WARN";
  return "PASS";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function loadTask(repositoryRoot: string, taskPath: string) {
  const absolutePath = path.resolve(repositoryRoot, taskPath);
  const source = await readFile(absolutePath);
  const markdown = source.toString("utf8");
  return {
    path: path.relative(repositoryRoot, absolutePath),
    sha256: sha256(source),
    requirements: parseTaskRequirements(markdown),
    mappings: [] as RequirementMapping[],
    changeCoverage: {
      attributedFiles: [] as string[],
      unattributedFiles: [] as string[],
    },
  };
}

function renderMarkdown(report: ReviewReport): string {
  const icon = report.verdict === "PASS" ? "✅" : report.verdict === "WARN" ? "⚠️" : "⛔";
  const checks = report.checks
    .map(
      (check) =>
        `| ${check.name} | ${check.status} | ${check.exitCode ?? "—"} | ${check.durationMs} ms | \`${check.command}\` |`
    )
    .join("\n");
  const findings = report.findings.length
    ? report.findings.map((finding) => `- **${finding.severity.toUpperCase()}**: ${finding.title}`).join("\n")
    : "No blocking or warning findings.";
  const requirements = report.task?.requirements.length
    ? report.task.requirements
        .map(
          (requirement) =>
            `- **${requirement.id}** ([line ${requirement.line}], ${requirement.confirmation}): ${requirement.text}`
        )
        .join("\n")
    : "No explicit numbered requirements were found.";
  const mappings = report.task?.mappings.length
    ? report.task.mappings
        .map(
          (mapping) =>
            `- **${mapping.requirementId}**: ${mapping.status} (${mapping.basis})${
              mapping.observedFiles.length
                ? ` — ${mapping.observedFiles.map((file) => `\`${file}\``).join(", ")}`
                : ""
            }`
        )
        .join("\n")
    : "No requirement mappings were produced.";
  const changeCoverage = report.task
    ? [
        `- Attributed changed files: ${report.task.changeCoverage.attributedFiles.length}`,
        `- Unattributed changed files: ${report.task.changeCoverage.unattributedFiles.length}`,
        ...report.task.changeCoverage.unattributedFiles.map((file) => `  - \`${file}\``),
      ].join("\n")
    : "No task was supplied, so change attribution was not evaluated.";

  return `# AgentShip Verification Report\n\n${icon} **${report.verdict}**\n\n- Run: \`${report.runId}\`\n- Commit: \`${report.repository.head}\`\n- Scope: ${report.repository.reviewScope}\n- Diff SHA-256: \`${report.repository.diffSha256}\`\n- Repository stable during checks: ${report.repository.stableDuringChecks ? "yes" : "no"}\n- Duration: ${report.durationMs} ms\n\n## Task requirements\n\n${requirements}\n\n## Requirement mapping\n\n${mappings}\n\n## Changed-file attribution\n\n${changeCoverage}\n\nUnattributed means no explicit \`change:path\` requirement matched the file; it does not mean the change is unrelated.\n\n## Executed checks\n\n| Check | Status | Exit | Duration | Command |\n| --- | --- | ---: | ---: | --- |\n${checks}\n\n## Findings\n\n${findings}\n`;
}
