import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareWithBaseline, loadBaseline } from "./baseline";
import { loadConfig } from "./config";
import { collectGitEvidence, getHead, resolveRepositoryRoot } from "./git";
import { runCheck } from "./runner";
import { applyOverride, loadOverride } from "./override";
import {
  findLatestCompatibleHistory,
  resolveHistoryDirectory,
} from "./history";
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
import type {
  AgentShipConfig,
  CheckEvidence,
  FindingSuppressionConfig,
  ProtectedPathPolicy,
  ReviewCheckConfig,
  ReviewFinding,
  ReviewFindingKind,
  ReviewReport,
  ReviewVerdict,
} from "./types";

interface BudgetExcess {
  budget: "changed_files" | "diff_bytes";
  observed: number;
  limit: number;
}

export interface RunReviewOptions {
  cwd: string;
  configPath?: string;
  taskPath?: string;
  base?: string;
  staged?: boolean;
  outputPath?: string;
  confirmedRequirementIds?: string[];
  baselinePath?: string;
  approvedProtectedPathPatterns?: string[];
  overridePath?: string;
  historyDirectory?: string;
}

export interface ProtectedPathEvidence {
  pattern: string;
  matchedFiles: string[];
  approval: "not_required" | "required" | "confirmed";
}

export async function runReview(options: RunReviewOptions): Promise<{
  report: ReviewReport;
  jsonPath: string;
  markdownPath: string;
  sarifPath: string;
  historyJsonPath?: string;
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
  const configurationSha256 = sha256(configSource);
  const budgetExcesses = evaluateReviewBudgets(
    config,
    gitEvidence.changedFiles,
    gitEvidence.diff
  );
  const protectedPaths = evaluateProtectedPaths(
    gitEvidence.changedFiles,
    config.policy?.protectedPaths,
    options.approvedProtectedPathPatterns
  );

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
    if (budgetExcesses.length > 0) {
      checks.push(skippedCheckEvidence(check, "review_budget_exceeded"));
      continue;
    }
    const matchedFiles = selectChangedFiles(check, gitEvidence.changedFiles);
    if (check.whenChanged && matchedFiles.length === 0) {
      checks.push(skippedCheckEvidence(check, "no_changed_path_match"));
      continue;
    }
    const evidence = await runCheck(check, repositoryRoot);
    checks.push(
      check.whenChanged
        ? {
            ...evidence,
            selection: { patterns: check.whenChanged, matchedFiles },
          }
        : evidence
    );
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
  const budget = config.limits
    ? {
        changedFiles: gitEvidence.changedFiles.length,
        diffBytes: Buffer.byteLength(gitEvidence.diff),
        limits: config.limits,
      }
    : undefined;
  const rawFindings = buildFindings(
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
      : undefined,
    budgetExcesses,
    protectedPaths
  );
  const policyFindings = applySuppressions(
    applyBlockingPolicy(rawFindings, config.policy?.blockOn),
    config.policy?.suppressions,
    new Date(started)
  );
  const override = options.overridePath
    ? await loadOverride(
        repositoryRoot,
        options.overridePath,
        {
          head,
          diffSha256,
          configurationSha256,
          taskSha256: task?.sha256,
        },
        new Date(started)
      )
    : undefined;
  const findings = override
    ? applyOverride(policyFindings, override)
    : policyFindings;
  const automaticBaselinePath =
    options.historyDirectory && !options.baselinePath
      ? await findLatestCompatibleHistory(
          repositoryRoot,
          options.historyDirectory,
          {
            configurationSha256,
            taskSha256: task?.sha256,
            reviewScope: gitEvidence.scope,
            base: options.base,
          }
        )
      : undefined;
  const effectiveBaselinePath = options.baselinePath ?? automaticBaselinePath;
  const baseline = effectiveBaselinePath
    ? compareWithBaseline(
        findings,
        await loadBaseline(repositoryRoot, effectiveBaselinePath)
      )
    : undefined;
  const verdict = calculateVerdict(findings);
  const finished = Date.now();
  const runId = randomUUID();
  const historyTarget = options.historyDirectory
    ? buildHistoryTarget(
        repositoryRoot,
        options.historyDirectory,
        new Date(finished),
        runId
      )
    : undefined;
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
      sha256: configurationSha256,
      blockingPolicy: {
        configuredKinds: config.policy?.blockOn ?? [],
      },
      protectedPaths,
    },
    checks,
    budget,
    baseline,
    override,
    history: historyTarget
      ? {
          directory: historyTarget.directory,
          selection: options.baselinePath
            ? "explicit"
            : automaticBaselinePath
              ? "automatic_compatible"
              : "none_found",
          recordedReport: historyTarget.relativeJsonPath,
        }
      : undefined,
    findings,
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      failed: checks.filter((check) => check.status === "failed").length,
      timedOut: checks.filter((check) => check.status === "timed_out").length,
      skipped: checks.filter((check) => check.status === "skipped").length,
      suppressed: findings.filter((finding) => finding.suppression).length,
      overridden: findings.filter((finding) => finding.override).length,
    },
  };

  const jsonPath = path.resolve(
    repositoryRoot,
    options.outputPath ?? `.agentship/reviews/${runId}.json`
  );
  const outputBase = jsonPath.replace(/\.json$/i, "");
  const markdownPath = `${outputBase}.md`;
  const sarifPath = `${outputBase}.sarif`;
  const jsonSource = `${JSON.stringify(report, null, 2)}\n`;
  const markdownSource = renderMarkdown(report);
  const sarifSource = `${JSON.stringify(renderSarif(report), null, 2)}\n`;
  await mkdir(path.dirname(jsonPath), { recursive: true });
  if (historyTarget) {
    await mkdir(historyTarget.absoluteDirectory, { recursive: true });
  }
  await Promise.all([
    writeFile(jsonPath, jsonSource, "utf8"),
    writeFile(markdownPath, markdownSource, "utf8"),
    writeFile(sarifPath, sarifSource, "utf8"),
    ...(historyTarget
      ? [
          writeFile(historyTarget.absoluteJsonPath, jsonSource, "utf8"),
          writeFile(historyTarget.absoluteMarkdownPath, markdownSource, "utf8"),
          writeFile(historyTarget.absoluteSarifPath, sarifSource, "utf8"),
        ]
      : []),
  ]);

  return {
    report,
    jsonPath,
    markdownPath,
    sarifPath,
    historyJsonPath: historyTarget?.absoluteJsonPath,
  };
}

function buildHistoryTarget(
  repositoryRoot: string,
  historyDirectory: string,
  finishedAt: Date,
  runId: string
) {
  const directory = resolveHistoryDirectory(repositoryRoot, historyDirectory);
  const timestamp = finishedAt.toISOString().replaceAll(":", "-");
  const baseName = `${timestamp}-${runId}`;
  const absoluteBase = path.join(directory.absolutePath, baseName);
  return {
    directory: directory.relativePath,
    absoluteDirectory: directory.absolutePath,
    absoluteJsonPath: `${absoluteBase}.json`,
    absoluteMarkdownPath: `${absoluteBase}.md`,
    absoluteSarifPath: `${absoluteBase}.sarif`,
    relativeJsonPath: path.relative(repositoryRoot, `${absoluteBase}.json`),
  };
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
      status: "passed" | "failed" | "timed_out" | "skipped" | "not_configured";
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
  },
  budgetExcesses: BudgetExcess[] = [],
  protectedPaths: ProtectedPathEvidence[] = []
): ReviewFinding[] {
  const findings = checks.flatMap((check, index): ReviewFinding[] => {
    if (check.status === "passed" || check.status === "skipped") return [];
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

  for (const excess of budgetExcesses) {
    findings.push({
      id: `budget-${excess.budget}`,
      severity: "blocker",
      kind: "review_budget_exceeded",
      title: `Review ${excess.budget.replaceAll("_", " ")} budget exceeded (${excess.observed} > ${excess.limit})`,
      evidence: excess,
    });
  }

  for (const protectedPath of protectedPaths) {
    if (protectedPath.approval !== "required") continue;
    findings.push({
      id: `protected-path-${sha256(protectedPath.pattern).slice(0, 12)}`,
      severity: "blocker",
      kind: "protected_path_approval_missing",
      title: `Protected path '${protectedPath.pattern}' requires manual approval`,
      evidence: {
        protectedPathPattern: protectedPath.pattern,
        expectedPaths: protectedPath.matchedFiles,
      },
    });
  }

  return findings;
}

export function evaluateProtectedPaths(
  changedFiles: string[],
  policies: ProtectedPathPolicy[] = [],
  approvedPatterns: string[] = []
): ProtectedPathEvidence[] {
  const configuredPolicies = policies ?? [];
  const approvalPatterns = new Set(
    configuredPolicies
      .filter(({ requireManualApproval }) => requireManualApproval)
      .map(({ pattern }) => pattern)
  );
  for (const pattern of approvedPatterns) {
    if (!approvalPatterns.has(pattern)) {
      throw new Error(
        `Protected-path approval '${pattern}' does not match a configured approval policy.`
      );
    }
  }
  const approved = new Set(approvedPatterns);
  return configuredPolicies
    .map(({ pattern, requireManualApproval }) => {
      const matchedFiles = changedFiles.filter((file) => pathMatches(pattern, file));
      const approval = !requireManualApproval
        ? "not_required" as const
        : approved.has(pattern)
          ? "confirmed" as const
          : "required" as const;
      return { pattern, matchedFiles, approval };
    })
    .filter(({ matchedFiles }) => matchedFiles.length > 0);
}

export function selectChangedFiles(
  check: ReviewCheckConfig,
  changedFiles: string[]
): string[] {
  if (!check.whenChanged) return changedFiles;
  return changedFiles.filter((file) =>
    check.whenChanged?.some((pattern) => pathMatches(pattern, file))
  );
}

export function evaluateReviewBudgets(
  config: Pick<AgentShipConfig, "limits">,
  changedFiles: string[],
  diff: string
): BudgetExcess[] {
  const excesses: BudgetExcess[] = [];
  if (
    config.limits?.maxChangedFiles !== undefined &&
    changedFiles.length > config.limits.maxChangedFiles
  ) {
    excesses.push({
      budget: "changed_files",
      observed: changedFiles.length,
      limit: config.limits.maxChangedFiles,
    });
  }
  const diffBytes = Buffer.byteLength(diff);
  if (
    config.limits?.maxDiffBytes !== undefined &&
    diffBytes > config.limits.maxDiffBytes
  ) {
    excesses.push({
      budget: "diff_bytes",
      observed: diffBytes,
      limit: config.limits.maxDiffBytes,
    });
  }
  return excesses;
}

function skippedCheckEvidence(
  check: ReviewCheckConfig,
  skipReason: CheckEvidence["skipReason"]
): CheckEvidence {
  const timestamp = new Date().toISOString();
  return {
    name: check.name,
    command: check.run,
    required: check.required !== false,
    network: check.network ?? "unspecified",
    environment: [],
    status: "skipped",
    exitCode: null,
    signal: null,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    stdout: "",
    stderr: "",
    outputTruncated: false,
    ...(check.whenChanged
      ? { selection: { patterns: check.whenChanged, matchedFiles: [] } }
      : {}),
    skipReason,
  };
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
  const activeFindings = findings.filter(
    (finding) => !finding.suppression && !finding.override
  );
  if (activeFindings.some((finding) => finding.severity === "blocker")) return "BLOCK";
  if (activeFindings.length > 0) return "WARN";
  return "PASS";
}

export function applyBlockingPolicy(
  findings: ReviewFinding[],
  blockOn: ReviewFindingKind[] = []
): ReviewFinding[] {
  const configuredKinds = new Set(blockOn);
  return findings.map((finding) =>
    configuredKinds.has(finding.kind)
      ? { ...finding, severity: "blocker" as const }
      : finding
  );
}

export function applySuppressions(
  findings: ReviewFinding[],
  suppressions: FindingSuppressionConfig[] = [],
  evaluatedAt = new Date()
): ReviewFinding[] {
  const evaluationDate = evaluatedAt.toISOString().slice(0, 10);
  return findings.map((finding) => {
    if (finding.severity !== "warning") return finding;
    const suppression = suppressions.find(
      (candidate) =>
        candidate.findingId === finding.id &&
        candidate.kind === finding.kind &&
        candidate.expiresAt >= evaluationDate
    );
    if (!suppression) return finding;
    return {
      ...finding,
      suppression: {
        id: suppression.id,
        owner: suppression.owner,
        reason: suppression.reason,
        expiresAt: suppression.expiresAt,
      },
    };
  });
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
            ...(finding.suppression || finding.override
              ? {
                  suppressions: [
                    {
                      kind: "external",
                      status: "accepted",
                      justification: finding.override
                        ? `${finding.override.id}: ${finding.override.reason}`
                        : `${finding.suppression?.id}: ${finding.suppression?.reason}`,
                    },
                  ],
                }
              : {}),
            properties: {
              findingId: finding.id,
              evidence: finding.evidence,
              ...(finding.suppression
                ? { suppression: finding.suppression }
                : {}),
              ...(finding.override ? { override: finding.override } : {}),
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
        `| ${check.name} | ${check.status} | ${check.exitCode ?? "—"} | ${check.durationMs} ms | ${
          check.skipReason
            ? `skipped: ${check.skipReason}`
            : check.selection
            ? check.selection.matchedFiles.length > 0
              ? check.selection.matchedFiles.map((file) => `\`${file}\``).join(", ")
              : "no path match"
            : "all changes"
        } | \`${check.command}\` |`
    )
    .join("\n");
  const findings = report.findings.length
    ? report.findings
        .map(
          (finding) =>
            `- **${finding.override ? "OVERRIDDEN " : finding.suppression ? "SUPPRESSED " : ""}${finding.severity.toUpperCase()}**: ${finding.title}${
              finding.suppression
                ? ` — \`${finding.suppression.id}\`, owner ${finding.suppression.owner}, expires ${finding.suppression.expiresAt}: ${finding.suppression.reason}`
                : finding.override
                  ? ` — \`${finding.override.id}\`, actor ${finding.override.actor}, expires ${finding.override.expiresAt}, source report SHA-256 \`${finding.override.reportSha256}\`: ${finding.override.reason}`
                : ""
            }`
        )
        .join("\n")
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
  const budget = report.budget
    ? [
        `- Changed files: ${report.budget.changedFiles}${
          report.budget.limits.maxChangedFiles === undefined
            ? ""
            : ` / ${report.budget.limits.maxChangedFiles}`
        }`,
        `- Diff bytes: ${report.budget.diffBytes}${
          report.budget.limits.maxDiffBytes === undefined
            ? ""
            : ` / ${report.budget.limits.maxDiffBytes}`
        }`,
      ].join("\n")
    : "No review input budgets were configured.";
  const baseline = report.baseline
    ? [
        `- Report: \`${report.baseline.path}\``,
        `- Run: \`${report.baseline.runId}\``,
        `- Commit: \`${report.baseline.head}\``,
        `- SHA-256: \`${report.baseline.sha256}\``,
        `- New findings: ${report.baseline.newFindings.length}`,
        ...report.baseline.newFindings.map(
          (finding) => `  - \`${finding.id}\` (${finding.kind}, ${finding.severity})`
        ),
        `- Existing findings: ${report.baseline.existingFindings.length}`,
        ...report.baseline.existingFindings.map(
          (finding) => `  - \`${finding.id}\` (${finding.kind}, ${finding.severity})`
        ),
        `- Resolved findings: ${report.baseline.resolvedFindings.length}`,
        ...report.baseline.resolvedFindings.map(
          (finding) => `  - \`${finding.id}\` (${finding.kind}, ${finding.severity})`
        ),
      ].join("\n")
    : "No baseline report was supplied.";
  const blockingPolicy = report.configuration.blockingPolicy.configuredKinds.length
    ? report.configuration.blockingPolicy.configuredKinds
        .map((kind) => `- \`${kind}\``)
        .join("\n")
    : "No additional finding kinds are promoted to blockers.";
  const protectedPaths = report.configuration.protectedPaths.length
    ? report.configuration.protectedPaths
        .map(
          ({ pattern, matchedFiles, approval }) =>
            `- \`${pattern}\`: ${approval} — ${matchedFiles.map((file) => `\`${file}\``).join(", ")}`
        )
        .join("\n")
    : "No configured protected paths matched this change.";
  const override = report.override
    ? [
        `- Record: \`${report.override.path}\``,
        `- Override ID: \`${report.override.id}\``,
        `- Actor: ${report.override.actor}`,
        `- Reason: ${report.override.reason}`,
        `- Expires: ${report.override.expiresAt}`,
        `- Source report: \`${report.override.sourceReport.path}\``,
        `- Source report SHA-256: \`${report.override.sourceReport.sha256}\``,
        `- Overridden findings: ${report.override.findings.length}`,
      ].join("\n")
    : "No override record was supplied.";
  const history = report.history
    ? [
        `- Directory: \`${report.history.directory}\``,
        `- Baseline selection: ${report.history.selection}`,
        `- Recorded report: \`${report.history.recordedReport}\``,
      ].join("\n")
    : "History recording was not enabled.";

  return `# AgentShip Verification Report\n\n${icon} **${report.verdict}**\n\n- Run: \`${report.runId}\`\n- Commit: \`${report.repository.head}\`\n- Scope: ${report.repository.reviewScope}\n- Diff SHA-256: \`${report.repository.diffSha256}\`\n- Repository stable during checks: ${report.repository.stableDuringChecks ? "yes" : "no"}\n- Duration: ${report.durationMs} ms\n\n## Blocking policy\n\nConfigured finding kinds promoted to blockers:\n\n${blockingPolicy}\n\nCore integrity blockers remain non-configurable.\n\n## Protected paths\n\n${protectedPaths}\n\nApprovals are local operator assertions bound to this report's diff hash; they are not authenticated signatures.\n\n## Override record\n\n${override}\n\nOverride actors are recorded claims until authenticated signing is implemented.\n\n## Report history\n\n${history}\n\n## Task requirements\n\n${requirements}\n\n## Requirement mapping\n\n${mappings}\n\n## Changed-file attribution\n\n${changeCoverage}\n\nUnattributed means no explicit \`change:path\` requirement matched the file; it does not mean the change is unrelated.\n\n## Review budgets\n\n${budget}\n\n## Baseline comparison\n\n${baseline}\n\n## Executed checks\n\n| Check | Status | Exit | Duration | Selection | Command |\n| --- | --- | ---: | ---: | --- | --- |\n${checks}\n\n## Findings\n\n${findings}\n`;
}
