import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;

export interface EvidenceSignatureStatement {
  schemaVersion: 1;
  type: "agentship.evidence-signature";
  algorithm: "Ed25519";
  reportBytes: number;
  reportSha256: string;
  publicKeySha256: string;
}

export interface EvidenceSignature extends EvidenceSignatureStatement {
  signature: string;
}

export async function signEvidenceReport(options: {
  repositoryRoot: string;
  reportPath: string;
  privateKeyPath: string;
  outputPath?: string;
}): Promise<{ signature: EvidenceSignature; outputPath: string }> {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const reportPath = await resolveRegularFile(options.reportPath, MAX_REPORT_BYTES, "Report");
  assertContained(reportPath, repositoryRoot, "Report");
  const privateKeyPath = await resolveRegularFile(
    options.privateKeyPath,
    MAX_KEY_BYTES,
    "Signing key"
  );
  assertOutside(privateKeyPath, repositoryRoot, "Signing key");
  if (process.platform !== "win32") {
    const keyStats = await stat(privateKeyPath);
    if ((keyStats.mode & 0o077) !== 0) {
      throw new Error("Signing key permissions must not grant group or other access.");
    }
  }

  const report = await readBounded(reportPath, MAX_REPORT_BYTES, "Report");
  assertAgentShipReport(report);
  const privateKey = createPrivateKey(await readBounded(privateKeyPath, MAX_KEY_BYTES, "Signing key"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Signing key must be an Ed25519 private key.");
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const statement: EvidenceSignatureStatement = {
    schemaVersion: 1,
    type: "agentship.evidence-signature",
    algorithm: "Ed25519",
    reportBytes: report.length,
    reportSha256: sha256(report),
    publicKeySha256: sha256(publicKeyDer),
  };
  const signature: EvidenceSignature = {
    ...statement,
    signature: sign(null, statementBytes(statement), privateKey).toString("base64"),
  };
  const defaultOutputPath = /\.json$/i.test(reportPath)
    ? reportPath.replace(/\.json$/i, ".sig.json")
    : `${reportPath}.sig.json`;
  const outputPath = path.resolve(options.outputPath ?? defaultOutputPath);
  if (outputPath === reportPath) {
    throw new Error("Signature output must not overwrite the signed report.");
  }
  await writeAtomicInsideRepository(
    repositoryRoot,
    outputPath,
    `${JSON.stringify(signature, null, 2)}\n`
  );
  return { signature, outputPath };
}

export async function verifyEvidenceSignature(options: {
  reportPath: string;
  signaturePath: string;
  publicKeyPath: string;
  trustedRoot?: string;
}): Promise<EvidenceSignatureStatement> {
  const reportPath = await resolveRegularFile(options.reportPath, MAX_REPORT_BYTES, "Report");
  const signaturePath = await resolveRegularFile(
    options.signaturePath,
    MAX_SIGNATURE_BYTES,
    "Signature"
  );
  const publicKeyPath = await resolveRegularFile(
    options.publicKeyPath,
    MAX_KEY_BYTES,
    "Public key"
  );
  if (options.trustedRoot) {
    assertOutside(publicKeyPath, await realpath(options.trustedRoot), "Public key");
  }
  const report = await readBounded(reportPath, MAX_REPORT_BYTES, "Report");
  assertAgentShipReport(report);
  const signature = parseSignature(
    await readBounded(signaturePath, MAX_SIGNATURE_BYTES, "Signature")
  );
  const publicKey = createPublicKey(
    await readBounded(publicKeyPath, MAX_KEY_BYTES, "Public key")
  );
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Public key must be an Ed25519 key.");
  }
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const expected: EvidenceSignatureStatement = {
    schemaVersion: 1,
    type: "agentship.evidence-signature",
    algorithm: "Ed25519",
    reportBytes: report.length,
    reportSha256: sha256(report),
    publicKeySha256: sha256(publicKeyDer),
  };
  for (const key of ["reportBytes", "reportSha256", "publicKeySha256"] as const) {
    if (signature[key] !== expected[key]) {
      throw new Error(`Evidence signature ${key} does not match the trusted inputs.`);
    }
  }
  const signatureBytes = decodeCanonicalBase64(signature.signature);
  if (signatureBytes.length !== 64) {
    throw new Error("Evidence signature must contain a 64-byte Ed25519 signature.");
  }
  if (!verify(null, statementBytes(expected), publicKey, signatureBytes)) {
    throw new Error("Evidence signature verification failed.");
  }
  return expected;
}

function parseSignature(source: Buffer): EvidenceSignature {
  let value: unknown;
  try {
    value = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Signature must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Signature must contain a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "algorithm",
    "publicKeySha256",
    "reportBytes",
    "reportSha256",
    "schemaVersion",
    "signature",
    "type",
  ];
  if (Object.keys(record).sort().join("\0") !== expectedKeys.sort().join("\0")) {
    throw new Error("Signature contains missing or unsupported fields.");
  }
  if (
    record.schemaVersion !== 1 ||
    record.type !== "agentship.evidence-signature" ||
    record.algorithm !== "Ed25519" ||
    !Number.isSafeInteger(record.reportBytes) ||
    (record.reportBytes as number) <= 0 ||
    typeof record.reportSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.reportSha256) ||
    typeof record.publicKeySha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.publicKeySha256) ||
    typeof record.signature !== "string"
  ) {
    throw new Error("Signature fields are invalid.");
  }
  return record as unknown as EvidenceSignature;
}

function assertAgentShipReport(source: Buffer): void {
  let value: unknown;
  try {
    value = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Report must contain valid JSON before signature processing.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1 ||
    ((value as Record<string, unknown>).tool as Record<string, unknown> | undefined)?.name !==
      "AgentShip Verify"
  ) {
    throw new Error("Report is not an AgentShip schema version 1 report.");
  }
}

function statementBytes(statement: EvidenceSignatureStatement): Buffer {
  return Buffer.from(JSON.stringify(statement), "utf8");
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Evidence signature is not canonical base64.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Evidence signature is not canonical base64.");
  }
  return decoded;
}

async function resolveRegularFile(
  candidate: string,
  maxBytes: number,
  label: string
): Promise<string> {
  const resolved = await realpath(candidate);
  const stats = await stat(resolved);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
  if (stats.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return resolved;
}

async function readBounded(
  candidate: string,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const source = await readFile(candidate);
  if (source.length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return source;
}

function assertContained(candidate: string, root: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a file inside the repository.`);
  }
}

function assertOutside(candidate: string, root: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the reviewed repository.`);
  }
}

async function writeAtomicInsideRepository(
  repositoryRoot: string,
  outputPath: string,
  source: string
): Promise<void> {
  const parent = await realpath(path.dirname(outputPath));
  assertContained(path.join(parent, path.basename(outputPath)), repositoryRoot, "Signature output");
  const temporaryPath = path.join(parent, `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
