import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  BUBBLEWRAP_PATH,
  prepareBubblewrapSandbox,
  type PreparedSandbox,
} from "./sandbox";
import type { CheckEvidence, ReviewCheckConfig } from "./types";

const MAX_OUTPUT_BYTES = 256 * 1024;
const TERMINATION_GRACE_MS = 1_000;
const STORAGE_SAMPLE_INTERVAL_MS = 250;
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
const PRLIMIT_PATH = "/usr/bin/prlimit";

interface CheckInvocation {
  file: string;
  args: string[];
  shell: boolean;
  execution: NonNullable<CheckEvidence["execution"]>;
}

export async function runCheck(
  check: ReviewCheckConfig,
  repositoryRoot: string,
  options: { maxTimeoutMs?: number; dependenciesRoot?: string } = {}
): Promise<CheckEvidence> {
  const started = Date.now();
  const budgetStarted = performance.now();
  const startedAt = new Date(started).toISOString();
  const configuredTimeoutMs = (check.timeoutSeconds ?? 120) * 1000;
  let timeoutMs = Math.max(
    1,
    Math.floor(
      options.maxTimeoutMs === undefined
        ? configuredTimeoutMs
        : Math.min(configuredTimeoutMs, options.maxTimeoutMs)
    )
  );
  const environment = buildCheckEnvironment(check);
  const secrets = collectSecrets(environment);
  let invocation: CheckInvocation | undefined;
  let sandbox: PreparedSandbox | undefined;
  const workspaceLimitBytes = check.resources?.maxWorkspaceMiB === undefined
    ? undefined
    : mebibytes(check.resources.maxWorkspaceMiB);
  let maxObservedWorkspaceBytes = 0;
  let storageExceeded = false;
  let storageAccountingFailed = false;
  try {
    if (check.isolation === "bubblewrap") {
      sandbox = await prepareBubblewrapSandbox(
        check,
        repositoryRoot,
        process.platform,
        existsSync(BUBBLEWRAP_PATH),
        options.dependenciesRoot ?? repositoryRoot,
        environment.PATH ?? "/usr/bin:/bin"
      );
    }
    invocation = buildCheckInvocation(
      check,
      process.platform,
      existsSync(PRLIMIT_PATH),
      sandbox
    );
    if (workspaceLimitBytes !== undefined) {
      if (!sandbox) {
        throw new Error("Configured maxWorkspaceMiB requires prepared bubblewrap isolation.");
      }
      let initial;
      try {
        initial = await sandbox.measureWritableStorage();
      } catch (error) {
        storageAccountingFailed = true;
        throw error;
      }
      maxObservedWorkspaceBytes = initial.bytes;
      if (initial.bytes > workspaceLimitBytes) {
        storageExceeded = true;
        throw new Error(
          `Bubblewrap writable storage starts above its ${workspaceLimitBytes}-byte limit (${initial.bytes} bytes observed).`
        );
      }
    }
    if (options.maxTimeoutMs !== undefined) {
      const remainingMs = options.maxTimeoutMs - (performance.now() - budgetStarted);
      if (remainingMs <= 0) {
        await sandbox?.cleanup();
        const finished = Date.now();
        return {
          name: check.name,
          command: check.run,
          required: check.required !== false,
          network: check.network ?? "unspecified",
          environment: Object.keys(environment).sort(),
          status: "timed_out",
          exitCode: null,
          signal: null,
          startedAt,
          finishedAt: new Date(finished).toISOString(),
          durationMs: finished - started,
          timeoutMs: Math.max(0, Math.floor(options.maxTimeoutMs)),
          stdout: "",
          stderr: "Aggregate check wall-clock budget expired during check preparation.",
          outputTruncated: false,
          execution: {
            ...invocation.execution,
            ...(workspaceLimitBytes === undefined
              ? {}
              : {
                  writableStorage: {
                    enforcement: "sampled-logical-bytes" as const,
                    limitBytes: workspaceLimitBytes,
                    maxObservedBytes: maxObservedWorkspaceBytes,
                    exceeded: storageExceeded,
                    accountingFailed: storageAccountingFailed,
                  },
                }),
          },
        };
      }
      timeoutMs = Math.min(configuredTimeoutMs, remainingMs);
    }
    timeoutMs = Math.max(1, Math.floor(timeoutMs));
  } catch (error) {
    await sandbox?.cleanup();
    const finished = Date.now();
    return {
      name: check.name,
      command: check.run,
      required: check.required !== false,
      network: check.network ?? "unspecified",
      environment: Object.keys(environment).sort(),
      status: "failed",
      exitCode: null,
      signal: null,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      timeoutMs,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      outputTruncated: false,
      execution: invocation
        ? {
            ...invocation.execution,
            ...(workspaceLimitBytes === undefined
              ? {}
              : {
                  writableStorage: {
                    enforcement: "sampled-logical-bytes",
                    limitBytes: workspaceLimitBytes,
                    maxObservedBytes: maxObservedWorkspaceBytes,
                    exceeded: storageExceeded,
                    accountingFailed: storageAccountingFailed,
                  },
                }),
          }
        : {
            backend: "unsupported",
            ...(check.resources ? { resourceLimits: check.resources } : {}),
          },
    };
  }

  if (!invocation) throw new Error("Check invocation was not prepared.");

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.file, invocation.args, {
      cwd: repositoryRoot,
      shell: invocation.shell,
      env: environment as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    let childClosed = false;
    let storageFailed = false;
    let storageFailureMessage: string | undefined;
    let storageSample: Promise<void> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => (cleanupPromise ??= sandbox?.cleanup() ?? Promise.resolve());

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
    let storageTimer: NodeJS.Timeout | undefined;
    const stopForStorage = (message: string, reason: "exceeded" | "accounting") => {
      if (storageFailed) return;
      storageFailed = true;
      storageExceeded = reason === "exceeded";
      storageAccountingFailed = reason === "accounting";
      storageFailureMessage = message;
      clearTimeout(timer);
      if (!childClosed) {
        terminateProcessTree(child.pid, "SIGTERM");
        forceKillTimer = setTimeout(
          () => terminateProcessTree(child.pid, "SIGKILL"),
          TERMINATION_GRACE_MS
        );
      }
    };
    const measureStorage = async () => {
      if (!sandbox || workspaceLimitBytes === undefined) return;
      try {
        const observed = await sandbox.measureWritableStorage();
        maxObservedWorkspaceBytes = Math.max(maxObservedWorkspaceBytes, observed.bytes);
        if (observed.bytes > workspaceLimitBytes) {
          stopForStorage(
            `Bubblewrap writable storage exceeded its ${workspaceLimitBytes}-byte limit (${observed.bytes} bytes observed).`,
            "exceeded"
          );
        }
      } catch (error) {
        stopForStorage(
          `Bubblewrap writable storage could not be measured: ${error instanceof Error ? error.message : String(error)}`,
          "accounting"
        );
      }
    };
    const requestStorageSample = () => {
      if (storageSample) return;
      storageSample = measureStorage().finally(() => {
        storageSample = undefined;
      });
    };
    child.once("error", (error) => {
      childClosed = true;
      clearTimeout(timer);
      if (storageTimer) clearInterval(storageTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      void cleanup().then(() => reject(error), reject);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(
        () => terminateProcessTree(child.pid, "SIGKILL"),
        TERMINATION_GRACE_MS
      );
    }, timeoutMs);
    if (workspaceLimitBytes !== undefined) {
      storageTimer = setInterval(requestStorageSample, STORAGE_SAMPLE_INTERVAL_MS);
    }

    child.once("close", async (exitCode, signal) => {
      childClosed = true;
      clearTimeout(timer);
      if (storageTimer) clearInterval(storageTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      await storageSample;
      if (!storageFailed && workspaceLimitBytes !== undefined) {
        await measureStorage();
      }
      if (storageFailureMessage) {
        stderr = append(stderr, Buffer.from(`\n${storageFailureMessage}`));
      }
      const finished = Date.now();
      let cleanupFailed = false;
      try {
        await cleanup();
      } catch (error) {
        cleanupFailed = true;
        stderr = append(
          stderr,
          Buffer.from(
            `\nAgentShip could not remove the disposable workspace: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
      resolve({
        name: check.name,
        command: check.run,
        required: check.required !== false,
        network: check.network ?? "unspecified",
        environment: Object.keys(environment).sort(),
        status:
          timedOut
            ? "timed_out"
            : exitCode === 0 && !cleanupFailed && !storageFailed
              ? "passed"
              : "failed",
        exitCode,
        signal,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        timeoutMs,
        stdout: redactSecrets(stdout, secrets),
        stderr: redactSecrets(stderr, secrets),
        outputTruncated,
        execution: {
          ...invocation.execution,
          ...(workspaceLimitBytes === undefined
            ? {}
            : {
                writableStorage: {
                  enforcement: "sampled-logical-bytes" as const,
                  limitBytes: workspaceLimitBytes,
                  maxObservedBytes: maxObservedWorkspaceBytes,
                  exceeded: storageExceeded,
                  accountingFailed: storageAccountingFailed,
                },
              }),
        },
      });
    });
  });
}

export function buildCheckInvocation(
  check: ReviewCheckConfig,
  platform: NodeJS.Platform = process.platform,
  prlimitAvailable = existsSync(PRLIMIT_PATH),
  sandbox?: PreparedSandbox
): CheckInvocation {
  if (check.isolation && !sandbox) {
    throw new Error(
      "Configured check isolation was not prepared; the check was not executed."
    );
  }
  const base: CheckInvocation = sandbox
    ? {
        file: sandbox.file,
        args: sandbox.args,
        shell: false,
        execution: sandbox.execution,
      }
    : {
        file: check.run,
        args: [],
        shell: true,
        execution: { backend: "direct" },
      };
  if (!check.resources) return base;
  const args = resourceLimitArguments(check);
  if (args.length === 0) return base;
  if (platform !== "linux" || !prlimitAvailable) {
    throw new Error(
      "Configured check resource limits require Linux with /usr/bin/prlimit; the check was not executed."
    );
  }
  args.push(
    "--",
    sandbox ? base.file : "/bin/sh",
    ...(sandbox ? base.args : ["-c", check.run])
  );
  return {
    file: PRLIMIT_PATH,
    args,
    shell: false,
    execution: sandbox?.execution ?? {
      backend: "linux-prlimit",
      resourceLimits: check.resources,
    },
  };
}

function resourceLimitArguments(check: ReviewCheckConfig): string[] {
  if (!check.resources) return [];
  const args: string[] = [];
  const ensureCoreLimit = () => {
    if (args.length === 0) args.push("--core=0:0");
  };
  const exact = (name: string, value: number) => {
    ensureCoreLimit();
    args.push(`--${name}=${value}:${value}`);
  };
  if (check.resources.cpuSeconds !== undefined) {
    exact("cpu", check.resources.cpuSeconds);
  }
  if (check.resources.memoryMiB !== undefined) {
    exact("as", mebibytes(check.resources.memoryMiB));
  }
  if (check.resources.maxFileSizeMiB !== undefined) {
    exact("fsize", mebibytes(check.resources.maxFileSizeMiB));
  }
  if (check.resources.maxOpenFiles !== undefined) {
    exact("nofile", check.resources.maxOpenFiles);
  }
  return args;
}

function mebibytes(value: number): number {
  return value * 1024 * 1024;
}

export function buildCheckEnvironment(check: ReviewCheckConfig): Record<string, string> {
  const allowed = new Set([...DEFAULT_ENVIRONMENT, ...(check.environment ?? [])]);
  return Object.fromEntries(
    [...allowed]
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .filter(
        ([name, value]) =>
          check.isolation !== "bubblewrap" || isolatedEnvironmentValueAllowed(name, value)
      )
  );
}

function isolatedEnvironmentValueAllowed(name: string, value: string): boolean {
  if (!SENSITIVE_ENVIRONMENT_NAME.test(name)) return true;
  if (/^no_proxy$/i.test(name)) return true;
  if (!/proxy/i.test(name)) return false;
  try {
    const proxy = new URL(value);
    return (
      (proxy.protocol === "http:" || proxy.protocol === "https:") &&
      !proxy.username &&
      !proxy.password &&
      (proxy.pathname === "" || proxy.pathname === "/") &&
      !proxy.search &&
      !proxy.hash
    );
  } catch {
    return false;
  }
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
