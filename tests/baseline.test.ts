import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compareWithBaseline,
  loadBaseline,
  parseBaselineReport,
} from "../src/review/baseline";
import type { ReviewFinding } from "../src/review/types";

function finding(
  id: string,
  kind: ReviewFinding["kind"],
  severity: ReviewFinding["severity"] = "warning"
): ReviewFinding {
  return { id, kind, severity, title: id, evidence: {} };
}

test("baseline comparison classifies new, existing, and resolved findings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-baseline-"));
  try {
    const source = `${JSON.stringify({
      schemaVersion: 1,
      runId: "prior-run",
      repository: { head: "prior-head" },
      findings: [
        {
          id: "requirement-R1",
          kind: "explicit_requirement_path_unchanged",
          severity: "warning",
        },
        {
          id: "check-1",
          kind: "required_check_failed",
          severity: "blocker",
        },
      ],
    })}\n`;
    await writeFile(path.join(directory, "prior.json"), source, "utf8");
    const baseline = await loadBaseline(directory, "prior.json");
    const comparison = compareWithBaseline(
      [
        finding("requirement-R1", "explicit_requirement_path_unchanged"),
        finding("requirement-R2", "inferred_requirement_role_missing"),
      ],
      baseline
    );

    assert.equal(comparison.path, "prior.json");
    assert.equal(comparison.runId, "prior-run");
    assert.equal(comparison.head, "prior-head");
    assert.match(comparison.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      comparison.newFindings.map(({ id }) => id),
      ["requirement-R2"]
    );
    assert.deepEqual(
      comparison.existingFindings.map(({ id }) => id),
      ["requirement-R1"]
    );
    assert.deepEqual(
      comparison.resolvedFindings.map(({ id }) => id),
      ["check-1"]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("baseline parsing rejects invalid schemas, findings, and duplicate identities", () => {
  assert.throws(() => parseBaselineReport("not-json"), /valid JSON/);
  assert.throws(
    () =>
      parseBaselineReport(
        JSON.stringify({ schemaVersion: 2, runId: "run", repository: {}, findings: [] })
      ),
    /schemaVersion: 1/
  );
  assert.throws(
    () =>
      parseBaselineReport(
        JSON.stringify({
          schemaVersion: 1,
          runId: "run",
          repository: { head: "head" },
          findings: [{ id: "finding", kind: "kind", severity: "notice" }],
        })
      ),
    /severity is invalid/
  );
  assert.throws(
    () =>
      parseBaselineReport(
        JSON.stringify({
          schemaVersion: 1,
          runId: "run",
          repository: { head: "head" },
          findings: [
            { id: "same", kind: "kind", severity: "warning" },
            { id: "same", kind: "kind", severity: "warning" },
          ],
        })
      ),
    /is duplicated/
  );
});

test("baseline limits reject oversized files and excessive finding counts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-baseline-limit-"));
  try {
    await writeFile(
      path.join(directory, "oversized.json"),
      Buffer.alloc(5 * 1024 * 1024 + 1, 32)
    );
    await assert.rejects(
      loadBaseline(directory, "oversized.json"),
      /exceeds 5242880 bytes/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const finding = { id: "finding", kind: "kind", severity: "warning" };
  assert.throws(
    () =>
      parseBaselineReport(
        JSON.stringify({
          schemaVersion: 1,
          runId: "run",
          repository: { head: "head" },
          findings: Array.from({ length: 10_001 }, () => finding),
        })
      ),
    /exceeds 10000 findings/
  );
});
