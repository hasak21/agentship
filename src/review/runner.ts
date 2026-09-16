import { spawn } from "node:child_process";
import type { CheckEvidence, ReviewCheckConfig } from "./types";

const MAX_OUTPUT_BYTES = 256 * 1024;
const TERMINATION_GRACE_MS = 1_000;
const DEFAULT_ENVIRONMENT = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "COMSPEC",
  "PATHEXT",
  "SYSTEMROOT",
  "LANG",
  "LC_ALL",
  "TERM",
  "CI",
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];
const SENSITIVE_ENVIRONMENT_NAME =
  /(api.?key|token|secret|password|credential|authorization|cookie|proxy)/i;

export async function runCheck(
  check: ReviewCheckConfig,
  repositoryRoot: string
): Promise<CheckEvidence> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timeoutMs = (check.timeoutSeconds ?? 120) * 1000;
  const environment = buildCheckEnvironment(check);
  const secrets = collectSecrets(environment);

  return new Promise((resolve, reject) => {
    const child = spawn(check.run, {
      cwd: repositoryRoot,
      shell: true,
      env: environment as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;

    const append = (current: string, chunk: Buffer): string => {
      const currentBytes = Buffer.byteLength(current);
      if (currentBytes >= MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        return current;
      }
      const remaining = MAX_OUTPUT_BYTES - currentBytes;
      if (chunk.length > remaining) outputTruncated = true;
      return current + chunk.subarray(0, remaining).toString("utf8");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    let forceKillTimer: NodeJS.Timeout | undefined;
    child.once("error", (error) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(
        () => terminateProcessTree(child.pid, "SIGKILL"),
        TERMINATION_GRACE_MS
      );
    }, timeoutMs);

    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const finished = Date.now();
      resolve({
        name: check.name,
        command: check.run,
        required: check.required !== false,
        network: check.network ?? "unspecified",
        environment: Object.keys(environment).sort(),
        status: timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
        exitCode,
        signal,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        stdout: redactSecrets(stdout, secrets),
        stderr: redactSecrets(stderr, secrets),
        outputTruncated,
      });
    });
  });
}

export function buildCheckEnvironment(check: ReviewCheckConfig): Record<string, string> {
  const allowed = new Set([...DEFAULT_ENVIRONMENT, ...(check.environment ?? [])]);
  return Object.fromEntries(
    [...allowed]
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  );
}

function collectSecrets(environment: Record<string, string>): Array<[string, string]> {
  return Object.entries(environment)
    .filter(
      (entry): entry is [string, string] =>
        SENSITIVE_ENVIRONMENT_NAME.test(entry[0]) &&
        entry[1].length >= 4
    )
    .sort((left, right) => right[1].length - left[1].length);
}

function redactSecrets(output: string, secrets: Array<[string, string]>): string {
  return secrets.reduce(
    (redacted, [name, value]) => redacted.split(value).join(`[REDACTED:${name}]`),
    output
  );
}

function terminateProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals
): void {
  if (!pid) return;

  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") args.push("/f");
    const killer = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}
