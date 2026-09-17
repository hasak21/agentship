import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
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
  if (!stdout.includes("AgentShip Verify") || !stdout.includes("--task <path>")) {
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
  console.log("Bundled CLI review and benchmark commands run outside the repository without node_modules.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
