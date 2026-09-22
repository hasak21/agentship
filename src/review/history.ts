import { open, readdir } from "node:fs/promises";
import path from "node:path";

const MAX_HISTORY_ENTRIES = 1_000;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export interface HistoryContext {
  configurationSha256: string;
  taskSha256?: string;
  reviewScope: "working-tree" | "staged" | "base";
  base?: string;
}

export function resolveHistoryDirectory(
  repositoryRoot: string,
  historyDirectory: string
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.resolve(repositoryRoot, historyDirectory);
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("History directory must be a repository-relative child path.");
  }
  return { absolutePath, relativePath };
}

export async function findLatestCompatibleHistory(
  repositoryRoot: string,
  historyDirectory: string,
  context: HistoryContext
): Promise<string | undefined> {
  const directory = resolveHistoryDirectory(repositoryRoot, historyDirectory);
  let entries;
  try {
    entries = await readdir(directory.absolutePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (entries.length > MAX_HISTORY_ENTRIES) {
    throw new Error(`History directory exceeds ${MAX_HISTORY_ENTRIES} entries.`);
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of candidates) {
    const absolutePath = path.join(directory.absolutePath, name);
    const report = await readHistoryReport(absolutePath);
    if (isCompatible(report, context)) {
      return path.relative(repositoryRoot, absolutePath);
    }
  }
  return undefined;
}

function isCompatible(
  report: Record<string, unknown>,
  context: HistoryContext
): boolean {
  if (report.schemaVersion !== 1) return false;
  const repository = objectOrUndefined(report.repository);
  const configuration = objectOrUndefined(report.configuration);
  if (!repository || !configuration) return false;
  const task = report.task === undefined ? undefined : objectOrUndefined(report.task);
  if (report.task !== undefined && !task) return false;
  return (
    configuration.sha256 === context.configurationSha256 &&
    (task?.sha256 as string | undefined) === context.taskSha256 &&
    repository.reviewScope === context.reviewScope &&
    repository.base === context.base
  );
}

async function readHistoryReport(
  absolutePath: string
): Promise<Record<string, unknown>> {
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("History report must be a regular file.");
    if (stats.size > MAX_REPORT_BYTES) {
      throw new Error(`History report exceeds ${MAX_REPORT_BYTES} bytes.`);
    }
    const source = await handle.readFile({ encoding: "utf8" });
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error(`History report '${path.basename(absolutePath)}' is invalid JSON.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("History report must contain a JSON object.");
    }
    return value as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
