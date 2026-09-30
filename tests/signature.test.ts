import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  signEvidenceReport,
  verifyEvidenceSignature,
} from "../src/review/signature";

function report(runId = "signed-run") {
  return {
    schemaVersion: 1,
    runId,
    tool: { name: "AgentShip Verify", version: "0.1.0" },
    repository: { head: "abc", diffSha256: "d".repeat(64) },
    findings: [],
  };
}

async function writeKeyPair(directory: string, name: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(directory, `${name}.private.pem`);
  const publicKeyPath = path.join(directory, `${name}.public.pem`);
  await writeFile(
    privateKeyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 }
  );
  await writeFile(
    publicKeyPath,
    publicKey.export({ format: "pem", type: "spki" }),
    "utf8"
  );
  await chmod(privateKeyPath, 0o600);
  return { privateKeyPath, publicKeyPath };
}

test("detached Ed25519 evidence signatures verify exact report bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-signature-"));
  const repositoryRoot = path.join(root, "repository");
  const keyRoot = path.join(root, "trusted-keys");
  try {
    await mkdir(repositoryRoot);
    await mkdir(keyRoot);
    const reportPath = path.join(repositoryRoot, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report(), null, 2)}\n`, "utf8");
    const keys = await writeKeyPair(keyRoot, "signer");

    const signed = await signEvidenceReport({
      repositoryRoot,
      reportPath,
      privateKeyPath: keys.privateKeyPath,
    });
    assert.equal(signed.signature.algorithm, "Ed25519");
    assert.equal(signed.signature.reportBytes, (await readFile(reportPath)).length);
    assert.match(signed.signature.reportSha256, /^[a-f0-9]{64}$/);
    assert.match(signed.signature.publicKeySha256, /^[a-f0-9]{64}$/);

    const verified = await verifyEvidenceSignature({
      reportPath,
      signaturePath: signed.outputPath,
      publicKeyPath: keys.publicKeyPath,
      trustedRoot: repositoryRoot,
    });
    assert.equal(verified.reportSha256, signed.signature.reportSha256);

    await writeFile(reportPath, `${JSON.stringify(report("tampered"))}\n`, "utf8");
    await assert.rejects(
      verifyEvidenceSignature({
        reportPath,
        signaturePath: signed.outputPath,
        publicKeyPath: keys.publicKeyPath,
        trustedRoot: repositoryRoot,
      }),
      /reportBytes|reportSha256 does not match/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signing rejects repository keys and verification rejects untrusted keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentship-key-boundary-"));
  const repositoryRoot = path.join(root, "repository");
  const keyRoot = path.join(root, "trusted-keys");
  try {
    await mkdir(repositoryRoot);
    await mkdir(keyRoot);
    const reportPath = path.join(repositoryRoot, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report())}\n`, "utf8");
    const trusted = await writeKeyPair(keyRoot, "trusted");
    const other = await writeKeyPair(keyRoot, "other");
    const inside = await writeKeyPair(repositoryRoot, "inside");

    await assert.rejects(
      signEvidenceReport({
        repositoryRoot,
        reportPath,
        privateKeyPath: inside.privateKeyPath,
      }),
      /Signing key must be outside the reviewed repository/
    );

    const signed = await signEvidenceReport({
      repositoryRoot,
      reportPath,
      privateKeyPath: trusted.privateKeyPath,
    });
    await assert.rejects(
      verifyEvidenceSignature({
        reportPath,
        signaturePath: signed.outputPath,
        publicKeyPath: other.publicKeyPath,
        trustedRoot: repositoryRoot,
      }),
      /publicKeySha256 does not match/
    );
    await assert.rejects(
      verifyEvidenceSignature({
        reportPath,
        signaturePath: signed.outputPath,
        publicKeyPath: inside.publicKeyPath,
        trustedRoot: repositoryRoot,
      }),
      /Public key must be outside the reviewed repository/
    );

    if (process.platform !== "win32") {
      await chmod(trusted.privateKeyPath, 0o644);
      await assert.rejects(
        signEvidenceReport({
          repositoryRoot,
          reportPath,
          privateKeyPath: trusted.privateKeyPath,
          outputPath: path.join(repositoryRoot, "insecure.sig.json"),
        }),
        /permissions must not grant group or other access/
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
