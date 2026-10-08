import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectVerifierProvenance } from "../src/review/provenance";

test("verifier provenance binds the canonical entrypoint bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-provenance-"));
  try {
    const entrypoint = path.join(root, "agentship.cjs");
    const source = Buffer.from("console.log('trusted verifier');\n", "utf8");
    await writeFile(entrypoint, source);

    const provenance = await collectVerifierProvenance(entrypoint);
    assert.equal(provenance.entrypoint, entrypoint);
    assert.equal(provenance.bytes, source.length);
    assert.equal(
      provenance.sha256,
      createHash("sha256").update(source).digest("hex")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier provenance rejects non-files and empty entrypoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-provenance-invalid-"));
  try {
    const directory = path.join(root, "directory");
    const empty = path.join(root, "empty.cjs");
    await mkdir(directory);
    await writeFile(empty, "", "utf8");

    await assert.rejects(
      collectVerifierProvenance(directory),
      /must be a regular file/
    );
    await assert.rejects(
      collectVerifierProvenance(empty),
      /must contain 1-/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
