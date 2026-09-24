import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "agentship-cli-"));
const isolatedCli = path.join(temporaryDirectory, "agentship.cjs");
const intentFixture = path.resolve("fixtures/intent/executable-patch-corpus.json");

try {
  await copyFile(path.resolve("dist/agentship.cjs"), isolatedCli);
  const { stdout } = await execFileAsync(process.execPath, [isolatedCli, "review", "--help"], {
    cwd: temporaryDirectory,
    encoding: "utf8",
  });
  if (
    !stdout.includes("AgentShip Verify") ||
    !stdout.includes("--task <path>") ||
    !stdout.includes("--baseline <path>") ||
    !stdout.includes("--override <path>") ||
    !stdout.includes("--history <dir>") ||
    !stdout.includes("agentship outcome") ||
    !stdout.includes("--approve-path <pattern>")
  ) {
    throw new Error("Bundled CLI help output is incomplete.");
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
  await writeFile(
    path.join(temporaryDirectory, "report.json"),
    `${JSON.stringify(sourceReport)}\n`,
    "utf8"
  );
  const outcome = await execFileAsync(
    process.execPath,
    [
      isolatedCli,
      "outcome",
      "--report",
      "report.json",
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
  console.log("Bundled CLI review, benchmark, and outcome commands run outside the repository without node_modules.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
