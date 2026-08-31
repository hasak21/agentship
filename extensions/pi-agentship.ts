/**
 * AgentShip Extension for Pi Coding Agent (pi-coding-agent)
 *
 * Provides instant Cross-Model Quality & Security Audits, Visual Diff integration,
 * and multi-agent topology consultations directly from your Pi terminal session.
 *
 * Usage:
 *   pi -e ./extensions/pi-agentship.ts
 *
 * Slash Commands:
 *   /audit [ref]      - Run 4-dimension quality & security audit on current diff
 *   /diff             - Output structured summary of modified files
 *   /agentship        - Check AgentShip Mission Control status & web dashboard
 */

export interface PiExtensionContext {
  exec: (command: string) => Promise<string>;
  log: (message: string) => void;
  registerCommand: (command: string, handler: (args: string) => Promise<void>) => void;
  on?: (event: string, handler: (data: unknown) => Promise<void>) => void;
}

export interface AuditResponse {
  overallScore: number;
  passed: boolean;
  auditorModel: string;
  summary: string;
  scores: {
    security: { score: number; comment: string };
    correctness: { score: number; comment: string };
    testCoverage: { score: number; comment: string };
    maintainability: { score: number; comment: string };
  };
  issues: Array<{
    id: string;
    category: string;
    severity: "blocker" | "warning" | "nitpick";
    title: string;
    description: string;
    file?: string;
    line?: number;
    suggestion?: string;
    fixPatch?: string;
  }>;
  tokens: number;
  ms: number;
}

const AGENTSHIP_HOST = process.env.AGENTSHIP_URL || "http://localhost:3000";

// Terminal styling helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bgRed: "\x1b[41m\x1b[37m",
  bgGreen: "\x1b[42m\x1b[30m",
};

export default function agentshipExtension(pi: PiExtensionContext) {
  // 1. Register /audit command
  pi.registerCommand("audit", async (args: string) => {
    pi.log(`\n${colors.cyan}${colors.bold}🛡️ AgentShip Cross-Model Quality & Security Gate${colors.reset}\n`);

    const gitDiffCmd = args.trim() ? `git diff ${args.trim()}` : "git diff HEAD";
    let diff = "";

    try {
      diff = await pi.exec(gitDiffCmd);
    } catch {
      diff = await pi.exec("git diff");
    }

    if (!diff || !diff.trim()) {
      pi.log(`${colors.yellow}No local git changes detected to audit.${colors.reset}\n`);
      return;
    }

    pi.log(`${colors.dim}Sending diff (${diff.split("\n").length} lines) to AgentShip at ${AGENTSHIP_HOST}/api/audit...${colors.reset}`);

    try {
      const res = await fetch(`${AGENTSHIP_HOST}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diff,
          context: "Pi CLI Coding Agent Session Audit",
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        pi.log(`${colors.red}Audit failed: ${errText}${colors.reset}\n`);
        return;
      }

      const report = (await res.json()) as AuditResponse;
      displayAuditReport(pi, report);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pi.log(
        `${colors.red}Could not connect to AgentShip (${AGENTSHIP_HOST}): ${errMsg}. Is the server running?${colors.reset}\n`
      );
    }
  });

  // 2. Register /diff command
  pi.registerCommand("diff", async () => {
    try {
      const diff = await pi.exec("git diff");
      if (!diff.trim()) {
        pi.log(`${colors.yellow}Working tree clean, no modified files.${colors.reset}\n`);
        return;
      }

      const res = await fetch(`${AGENTSHIP_HOST}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "inspect_diff",
            arguments: { diff },
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const parsed = JSON.parse(json.result?.content?.[0]?.text || "{}");
        pi.log(`\n${colors.bold}📁 Diff Overview: ${parsed.fileCount} files modified (+${parsed.totalAdditions} -${parsed.totalDeletions})${colors.reset}`);
        for (const file of parsed.files || []) {
          pi.log(`  • ${colors.cyan}${file.newPath}${colors.reset} (+${file.additions} -${file.deletions}) [${file.language}]`);
        }
        pi.log("");
      }
    } catch {
      pi.log(`${colors.red}Failed to inspect diff.${colors.reset}\n`);
    }
  });

  // 3. Register /agentship status command
  pi.registerCommand("agentship", async () => {
    pi.log(`\n${colors.bold}✦ AgentShip Mission Control${colors.reset}`);
    pi.log(`Dashboard: ${colors.cyan}${AGENTSHIP_HOST}${colors.reset}`);
    pi.log(`MCP Server: ${colors.cyan}${AGENTSHIP_HOST}/api/mcp${colors.reset}\n`);
  });
}

function displayAuditReport(pi: PiExtensionContext, report: AuditResponse) {
  const statusBadge = report.passed
    ? `${colors.bgGreen} PASSED ${colors.reset}`
    : `${colors.bgRed} BLOCKED ${colors.reset}`;

  pi.log(`\n${colors.bold}Audit Score: ${report.overallScore}/100 ${statusBadge} ${colors.dim}(Audited by ${report.auditorModel} in ${(report.ms / 1000).toFixed(1)}s)${colors.reset}`);
  pi.log(`${colors.dim}${report.summary}${colors.reset}\n`);

  pi.log(`${colors.bold}Dimension Breakdown:${colors.reset}`);
  pi.log(`  🛡️ Security:       ${report.scores.security.score.toFixed(1)}/10 — ${report.scores.security.comment}`);
  pi.log(`  ⚙️ Correctness:    ${report.scores.correctness.score.toFixed(1)}/10 — ${report.scores.correctness.comment}`);
  pi.log(`  🧪 Test Coverage:  ${report.scores.testCoverage.score.toFixed(1)}/10 — ${report.scores.testCoverage.comment}`);
  pi.log(`  🧹 Maintainability:${report.scores.maintainability.score.toFixed(1)}/10 — ${report.scores.maintainability.comment}\n`);

  if (report.issues.length === 0) {
    pi.log(`${colors.green}✓ Clean review! No blockers, warnings, or nitpicks found.${colors.reset}\n`);
    return;
  }

  pi.log(`${colors.bold}Findings (${report.issues.length}):${colors.reset}`);
  for (const issue of report.issues) {
    let sevBadge = "";
    if (issue.severity === "blocker") sevBadge = `${colors.red}[BLOCKER]${colors.reset}`;
    else if (issue.severity === "warning") sevBadge = `${colors.yellow}[WARNING]${colors.reset}`;
    else sevBadge = `${colors.blue}[NITPICK]${colors.reset}`;

    pi.log(`  ${sevBadge} ${colors.bold}${issue.title}${colors.reset} ${issue.file ? `${colors.dim}(${issue.file}:${issue.line || 1})${colors.reset}` : ""}`);
    pi.log(`     ${issue.description}`);
    if (issue.suggestion) {
      pi.log(`     ${colors.green}↳ Suggestion: ${issue.suggestion}${colors.reset}`);
    }
  }
  pi.log("");
}
