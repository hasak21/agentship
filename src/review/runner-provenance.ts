import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import os from "node:os";
import type { RunnerProvenance } from "./types";

const MAX_NODE_BYTES = 256 * 1024 * 1024;
const MAX_OS_RELEASE_BYTES = 64 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

type RunnerEnvironment = Partial<Record<string, string | undefined>>;

export async function collectRunnerProvenance(options: {
  platform?: NodeJS.Platform;
  architecture?: string;
  kernelRelease?: string;
  nodeVersion?: string;
  nodeExecutable?: string;
  environment?: RunnerEnvironment;
  osReleasePath?: string;
} = {}): Promise<RunnerProvenance> {
  const platform = options.platform ?? process.platform;
  const node = await hashStableRegularFile(
    options.nodeExecutable ?? process.execPath,
    MAX_NODE_BYTES,
    "Node executable"
  );
  const environment = options.environment ?? process.env;
  const github = compactObject({
    environment: boundedEnvironment(environment.RUNNER_ENVIRONMENT, "RUNNER_ENVIRONMENT"),
    runnerOs: boundedEnvironment(environment.RUNNER_OS, "RUNNER_OS"),
    runnerArch: boundedEnvironment(environment.RUNNER_ARCH, "RUNNER_ARCH"),
    imageOs: boundedEnvironment(environment.ImageOS, "ImageOS"),
    imageVersion: boundedEnvironment(environment.ImageVersion, "ImageVersion"),
  });
  const osRelease =
    platform === "linux"
      ? await collectOptionalOsRelease(options.osReleasePath ?? "/etc/os-release")
      : undefined;
  return {
    platform,
    architecture: boundedValue(options.architecture ?? process.arch, "architecture", 64),
    kernelRelease: boundedValue(
      options.kernelRelease ?? os.release(),
      "kernel release",
      256
    ),
    osRelease,
    node: {
      version: boundedValue(options.nodeVersion ?? process.version, "Node version", 64),
      executable: node.path,
      bytes: node.bytes,
      sha256: node.sha256,
    },
    ...(Object.keys(github).length > 0 ? { github } : {}),
  };
}

async function collectOptionalOsRelease(
  candidate: string
): Promise<RunnerProvenance["osRelease"]> {
  try {
    return await collectOsRelease(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function collectOsRelease(
  candidate: string
): Promise<RunnerProvenance["osRelease"]> {
  const file = await hashStableRegularFile(
    candidate,
    MAX_OS_RELEASE_BYTES,
    "OS release manifest"
  );
  const handle = await open(file.path, "r");
  try {
    const sourceBytes = await handle.readFile();
    if (
      sourceBytes.length > MAX_OS_RELEASE_BYTES ||
      createHash("sha256").update(sourceBytes).digest("hex") !== file.sha256
    ) {
      throw new Error("OS release manifest changed while it was being collected.");
    }
    const source = sourceBytes.toString("utf8");
    const fields = new Map<string, string>();
    for (const line of source.split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || rawValue === undefined) continue;
      fields.set(key, unquoteOsRelease(rawValue));
    }
    return {
      id: optionalBoundedValue(fields.get("ID"), "OS release ID", 128),
      versionId: optionalBoundedValue(
        fields.get("VERSION_ID"),
        "OS release version ID",
        128
      ),
      prettyName: optionalBoundedValue(
        fields.get("PRETTY_NAME"),
        "OS release pretty name",
        256
      ),
      sha256: file.sha256,
    };
  } finally {
    await handle.close();
  }
}

async function hashStableRegularFile(
  candidate: string,
  maxBytes: number,
  label: string
): Promise<{ path: string; bytes: number; sha256: string }> {
  const resolved = await realpath(candidate);
  const handle = await open(resolved, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file.`);
    if (before.size <= 0 || before.size > maxBytes) {
      throw new Error(`${label} must contain 1-${maxBytes} bytes.`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, before.size));
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ino !== before.ino
    ) {
      throw new Error(`${label} changed while it was being hashed.`);
    }
    return { path: resolved, bytes: position, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

function unquoteOsRelease(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).replace(/\\([\\"'$`])/g, "$1");
  }
  return value;
}

function boundedEnvironment(value: string | undefined, name: string): string | undefined {
  return optionalBoundedValue(value, name, 256);
}

function optionalBoundedValue(
  value: string | undefined,
  label: string,
  maxLength: number
): string | undefined {
  return value === undefined ? undefined : boundedValue(value, label, maxLength);
}

function boundedValue(value: string, label: string, maxLength: number): string {
  if (
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    throw new Error(`${label} must be non-empty and at most ${maxLength} safe characters.`);
  }
  return value;
}

function compactObject<T extends Record<string, string | undefined>>(
  value: T
): { [K in keyof T]?: string } {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ) as { [K in keyof T]?: string };
}
