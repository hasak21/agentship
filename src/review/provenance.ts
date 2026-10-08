import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";

const MAX_VERIFIER_BYTES = 32 * 1024 * 1024;

export interface VerifierProvenance {
  entrypoint: string;
  bytes: number;
  sha256: string;
}

export async function collectVerifierProvenance(
  entrypoint: string
): Promise<VerifierProvenance> {
  const resolved = await realpath(entrypoint);
  const handle = await open(resolved, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error("AgentShip verifier entrypoint must be a regular file.");
    }
    if (before.size <= 0 || before.size > MAX_VERIFIER_BYTES) {
      throw new Error(
        `AgentShip verifier entrypoint must contain 1-${MAX_VERIFIER_BYTES} bytes.`
      );
    }
    const source = await handle.readFile();
    const after = await handle.stat();
    if (
      source.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ino !== before.ino
    ) {
      throw new Error("AgentShip verifier entrypoint changed while it was being hashed.");
    }
    return {
      entrypoint: resolved,
      bytes: source.length,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  } finally {
    await handle.close();
  }
}
