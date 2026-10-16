import { createHash } from "node:crypto";
import type { ExternalEvaluationCorpus } from "./intent-benchmark";

export const MAX_ADJUDICATION_BYTES = 8 * 1024 * 1024;
type ExternalCase = ExternalEvaluationCorpus["cases"][number];
type Decision = "omission" | "complete" | "abstain" | "unreviewed";

export interface OmissionAdjudicationCase {
  id: string;
  requirement: string;
  requirementSha256: string;
  changedFiles: string[];
  diff: string;
  predictionSha256: string;
  repository: string;
  baseCommit: string;
  decision: Decision;
  rationale: string;
  evidence: string[];
}

export interface OmissionAdjudicationPacket {
  schemaVersion: 1;
  kind: "omission_adjudication";
  corpusSha256: string;
  reviewer: string;
  cases: OmissionAdjudicationCase[];
}

export interface AdjudicationCoverage {
  reviewer: string;
  total: number;
  decided: number;
  abstained: number;
  unreviewed: number;
}

export function createOmissionAdjudicationPacket(
  cases: readonly ExternalCase[],
  corpusSha256: string
): OmissionAdjudicationPacket {
  const packet: OmissionAdjudicationPacket = {
    schemaVersion: 1,
    kind: "omission_adjudication",
    corpusSha256,
    reviewer: "",
    cases: cases.map((item) => {
      const diff = item.diff ?? "";
      if (sha256(diff) !== item.source.predictionSha256) {
        throw new Error(`Candidate '${item.id}' patch digest does not match its source.`);
      }
      return {
        id: item.id,
        requirement: item.requirement,
        requirementSha256: sha256(item.requirement),
        changedFiles: [...item.changedFiles],
        diff,
        predictionSha256: item.source.predictionSha256,
        repository: item.source.repository,
        baseCommit: item.source.baseCommit,
        decision: "unreviewed",
        rationale: "",
        evidence: [],
      };
    }),
  };
  if (Buffer.byteLength(JSON.stringify(packet)) > MAX_ADJUDICATION_BYTES) {
    throw new Error("Omission adjudication packet exceeds its byte limit.");
  }
  return packet;
}

export function applyOmissionAdjudications(
  cases: readonly ExternalCase[],
  corpusSha256: string,
  input: unknown
): {
  cases: ExternalCase[];
  decisions: Map<string, Pick<OmissionAdjudicationCase, "decision" | "rationale" | "evidence">>;
  coverage: AdjudicationCoverage;
} {
  const value = object(input, "Adjudication packet");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "omission_adjudication" ||
    value.corpusSha256 !== corpusSha256
  ) throw new Error("Adjudication packet schema or corpus hash does not match.");
  const reviewer = boundedText(value.reviewer, "Adjudication reviewer", 200);
  if (!Array.isArray(value.cases) || value.cases.length !== cases.length) {
    throw new Error("Adjudication packet must retain every corpus case.");
  }
  const expected = createOmissionAdjudicationPacket(cases, corpusSha256);
  const byId = new Map(expected.cases.map((item) => [item.id, item]));
  const decisions = new Map<string, Pick<OmissionAdjudicationCase, "decision" | "rationale" | "evidence">>();
  const coverage: AdjudicationCoverage = {
    reviewer, total: cases.length, decided: 0, abstained: 0, unreviewed: 0,
  };
  for (const raw of value.cases) {
    const row = object(raw, "Adjudication case");
    const id = boundedText(row.id, "Adjudication case id", 500);
    const original = byId.get(id);
    if (!original || decisions.has(id)) {
      throw new Error(`Adjudication case '${id}' is unknown or duplicated.`);
    }
    for (const field of [
      "requirement", "requirementSha256", "diff", "predictionSha256", "repository", "baseCommit",
    ] as const) {
      if (row[field] !== original[field]) {
        throw new Error(`Adjudication case '${id}' changed its bound ${field}.`);
      }
    }
    if (JSON.stringify(row.changedFiles) !== JSON.stringify(original.changedFiles)) {
      throw new Error(`Adjudication case '${id}' changed its bound changedFiles.`);
    }
    if (typeof row.decision !== "string" || !["omission", "complete", "abstain", "unreviewed"].includes(row.decision)) {
      throw new Error(`Adjudication case '${id}' has an unsupported decision.`);
    }
    const decision = row.decision as Decision;
    const rationale = decision === "unreviewed"
      ? ""
      : boundedText(row.rationale, `Adjudication case '${id}' rationale`, 4_000);
    if (
      !Array.isArray(row.evidence) || row.evidence.length > 20 ||
      ((decision === "omission" || decision === "complete") && row.evidence.length === 0)
    ) throw new Error(`Adjudication case '${id}' requires bounded evidence locators.`);
    const evidence = row.evidence.map((item) =>
      boundedText(item, `Adjudication case '${id}' evidence`, 2_000)
    );
    decisions.set(id, { decision, rationale, evidence });
    if (decision === "unreviewed") coverage.unreviewed++;
    else if (decision === "abstain") coverage.abstained++;
    else coverage.decided++;
  }
  if (coverage.decided === 0) {
    throw new Error("Adjudication packet contains no decided omission labels.");
  }
  return {
    cases: cases.flatMap((item) => {
      const label = decisions.get(item.id)!;
      return label.decision === "omission" || label.decision === "complete"
        ? [{ ...item, omissionExpected: label.decision === "omission", rationale: label.rationale }]
        : [];
    }),
    decisions,
    coverage,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" || !value.trim() || value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error(`${label} must be bounded non-empty text without controls.`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
