import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { collectGitEvidence, getHead, resolveRepositoryRoot } from "./git";
import { runCheck } from "./runner";
import {
  applyRequirementConfirmations,
  parseTaskOptions,
  parseTaskRequirements,
} from "./task-parser";
import {
  mapRequirementsToChangedFiles,
  pathMatches,
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
  sarifPath: string;
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
  }

  const checks: CheckEvidence[] = [];
  for (const check of config.checks) {
    checks.push(await runCheck(check, repositoryRoot));
  }
  if (task) {
    task.mappings = mapRequirementsToChangedFiles(
      task.requirements,
      gitEvidence.changedFiles,
      checks,
      gitEvidence.diff
    );
    task.requirements = applyRequirementConfirmations(
      task.requirements,
      options.confirmedRequirementIds ?? [],
      findProtectedRequirementIds(task.mappings, config.policy?.protectedPaths)
    );
    task.changeCoverage = summarizeChangeCoverage(
      task.mappings,
      gitEvidence.changedFiles,
      [task.path]
    );
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
    task?.requirements,
    task
      ? {
          strict: task.options.strictChangeCoverage,
          unattributedFiles: task.changeCoverage.unattributedFiles,
        }
      : undefined
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
  const outputBase = jsonPath.replace(/\.json$/i, "");
  const markdownPath = `${outputBase}.md`;
  const sarifPath = `${outputBase}.sarif`;
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderMarkdown(report), "utf8"),
    writeFile(sarifPath, `${JSON.stringify(renderSarif(report), null, 2)}\n`, "utf8"),
  ]);

  return { report, jsonPath, markdownPath, sarifPath };
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
    status:
      | "observed"
      | "missing"
      | "inferred_observed"
      | "inferred_missing"
      | "unmapped";
    references: string[];
    missingReferences: string[];
    checkEvidence: Array<{
      name: string;
      status: "passed" | "failed" | "timed_out" | "not_configured";
    }>;
    symbolEvidence: Array<{
      path: string;
      symbol: string;
      status: "changed" | "file_unchanged" | "symbol_not_in_diff" | "diff_unavailable";
    }>;
    missingRoles: Array<"test" | "documentation">;
  }> = [],
  requirements: Array<{
    id: string;
    confirmation: "not_required" | "required" | "confirmed";
  }> = [],
  changeCoverage?: {
    strict: boolean;
    unattributedFiles: string[];
  }
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
    if (mapping.status !== "missing" && mapping.status !== "inferred_missing") {
      continue;
    }
    const unsatisfiedChecks = mapping.checkEvidence
      .filter(({ status }) => status !== "passed")
      .map(({ name, status }) => ({ name, status }));
    const unsatisfiedSymbols = mapping.symbolEvidence
      .filter(({ status }) => status !== "changed")
      .map(({ path, symbol, status }) => ({ path, symbol, status }));
    findings.push({
      id: `requirement-${mapping.requirementId}`,
      severity: "warning",
      kind:
        mapping.status === "inferred_missing"
          ? "inferred_requirement_role_missing"
          : unsatisfiedChecks.length > 0 || unsatisfiedSymbols.length > 0
          ? "explicit_requirement_evidence_unsatisfied"
          : "explicit_requirement_path_unchanged",
      title:
        mapping.status === "inferred_missing"
          ? `${mapping.requirementId} appears to require changed ${mapping.missingRoles.join(" and ")} evidence`
          : unsatisfiedChecks.length > 0 || unsatisfiedSymbols.length > 0
          ? `${mapping.requirementId} has unsatisfied explicit evidence`
          : `${mapping.requirementId} names repository paths absent from the reviewed change`,
      evidence: {
        requirementId: mapping.requirementId,
        expectedPaths: mapping.missingReferences,
        expectedChecks: unsatisfiedChecks,
        expectedSymbols: unsatisfiedSymbols,
        expectedRoles: mapping.missingRoles,
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

  if (changeCoverage?.strict && changeCoverage.unattributedFiles.length > 0) {
    findings.push({
      id: "strict-change-coverage",
      severity: "warning",
      kind: "unattributed_changes",
      title: `${changeCoverage.unattributedFiles.length} changed file(s) lack explicit requirement attribution`,
      evidence: { unexpectedPaths: changeCoverage.unattributedFiles },
    });
  }

  return findings;
}

export function findProtectedRequirementIds(
  mappings: RequirementMapping[],
  protectedPaths: Array<{
    pattern: string;
    requireManualApproval?: boolean;
  }> = []
): string[] {
  const approvalPatterns = protectedPaths
    .filter(({ requireManualApproval }) => requireManualApproval)
    .map(({ pattern }) => pattern);
  return mappings
    .filter((mapping) => {
      const evidenceFiles = [
        ...mapping.observedFiles,
        ...mapping.symbolEvidence
          .filter(({ status }) => status === "changed")
          .map(({ path }) => path),
      ];
      return evidenceFiles.some((file) =>
        approvalPatterns.some((pattern) => pathMatches(pattern, file))
      );
    })
    .map(({ requirementId }) => requirementId);
}

export function calculateVerdict(findings: ReviewFinding[]): ReviewVerdict {
  if (findings.some((finding) => finding.severity === "blocker")) return "BLOCK";
  if (findings.length > 0) return "WARN";
  return "PASS";
}

export function renderSarif(report: ReviewReport) {
  const rules = Array.from(
    new Map(
      report.findings.map((finding) => [
        finding.kind,
        {
          id: finding.kind,
          name: finding.kind,
          shortDescription: { text: finding.title },
        },
      ])
    ).values()
  );

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            properties: {
              runId: report.runId,
              verdict: report.verdict,
              diffSha256: report.repository.diffSha256,
            },
          },
        ],
        results: report.findings.map((finding) => {
          const location = findingLocation(finding);
          return {
            ruleId: finding.kind,
            level: finding.severity === "blocker" ? "error" : "warning",
            message: { text: finding.title },
            ...(location
              ? {
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: encodeURI(location) },
                      },
                    },
                  ],
                }
              : {}),
            properties: {
              findingId: finding.id,
              evidence: finding.evidence,
            },
          };
        }),
      },
    ],
  };
}

function findingLocation(finding: ReviewFinding): string | undefined {
  const candidate =
    finding.evidence.expectedPaths?.[0] ??
    finding.evidence.expectedSymbols?.[0]?.path ??
    finding.evidence.unexpectedPaths?.[0];
  if (!candidate) return undefined;

  const normalized = candidate.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
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
    options: parseTaskOptions(markdown),
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
            `- **${requirement.id}** ([line ${requirement.line}], ${requirement.confirmation}${
              requirement.confirmationBasis.length
                ? ` via ${requirement.confirmationBasis.join("+")}`
                : ""
            }): ${requirement.text}`
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
            }${
              mapping.missingReferences.length
                ? ` — missing ${mapping.missingReferences.map((reference) => `\`${reference}\``).join(", ")}`
                : ""
            }${
              mapping.checkEvidence.length
                ? ` — checks ${mapping.checkEvidence.map(({ name, status }) => `\`${name}\`=${status}`).join(", ")}`
                : ""
            }${
              mapping.symbolEvidence.length
                ? ` — symbols ${mapping.symbolEvidence.map(({ path, symbol, status }) => `\`${path}#${symbol}\`=${status}`).join(", ")}`
                : ""
            }${
              mapping.roleEvidence.length
                ? ` — inferred ${mapping.roleEvidence.map(({ role, observedFiles }) => `${role}=${observedFiles.length ? observedFiles.map((file) => `\`${file}\``).join(",") : "missing"}`).join("; ")}`
                : ""
            }`
        )
        .join("\n")
    : "No requirement mappings were produced.";
  const changeCoverage = report.task
    ? [
        `- Mode: ${report.task.options.strictChangeCoverage ? "strict" : "advisory"}`,
        `- Attributed changed files: ${report.task.changeCoverage.attributedFiles.length}`,
        `- Unattributed changed files: ${report.task.changeCoverage.unattributedFiles.length}`,
        ...report.task.changeCoverage.unattributedFiles.map((file) => `  - \`${file}\``),
      ].join("\n")
    : "No task was supplied, so change attribution was not evaluated.";

  return `# AgentShip Verification Report\n\n${icon} **${report.verdict}**\n\n- Run: \`${report.runId}\`\n- Commit: \`${report.repository.head}\`\n- Scope: ${report.repository.reviewScope}\n- Diff SHA-256: \`${report.repository.diffSha256}\`\n- Repository stable during checks: ${report.repository.stableDuringChecks ? "yes" : "no"}\n- Duration: ${report.durationMs} ms\n\n## Task requirements\n\n${requirements}\n\n## Requirement mapping\n\n${mappings}\n\n## Changed-file attribution\n\n${changeCoverage}\n\nUnattributed means no explicit \`change:path\` requirement matched the file; it does not mean the change is unrelated.\n\n## Executed checks\n\n| Check | Status | Exit | Duration | Command |\n| --- | --- | ---: | ---: | --- |\n${checks}\n\n## Findings\n\n${findings}\n`;
}
