import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/review/config";

async function withConfig(source: string, run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-config-"));
  try {
    await writeFile(path.join(directory, ".agentship.yml"), source, "utf8");
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("configuration accepts exact and trailing-directory protected paths", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  protectedPaths:
    - pattern: src/payments/**
      requireManualApproval: true
    - pattern: src/secrets.ts
      requireManualApproval: true
`,
    async (directory) => {
      const { config } = await loadConfig(directory);
      assert.equal(config.policy?.protectedPaths?.length, 2);
    }
  );
});

test("configuration rejects unsupported protected path wildcards", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  protectedPaths:
    - pattern: src/*/secrets.ts
      requireManualApproval: true
`,
    async (directory) => {
      await assert.rejects(
        loadConfig(directory),
        /repository-relative and supports only exact paths or trailing \/\*\*/
      );
    }
  );
});

test("configuration rejects protected paths outside the repository", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  protectedPaths:
    - pattern: ../secrets/**
      requireManualApproval: true
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /must be repository-relative/);
    }
  );
});

test("configuration accepts path-aware checks and review input budgets", async () => {
  await withConfig(
    `version: 1
mode: report
limits:
  maxChangedFiles: 100
  maxDiffBytes: 1048576
checks:
  - name: review
    run: npm test
    whenChanged:
      - src/review/**
      - package.json
`,
    async (directory) => {
      const { config } = await loadConfig(directory);
      assert.deepEqual(config.checks[0]?.whenChanged, [
        "src/review/**",
        "package.json",
      ]);
      assert.deepEqual(config.limits, {
        maxChangedFiles: 100,
        maxDiffBytes: 1048576,
      });
    }
  );
});

test("configuration rejects unsafe check paths and invalid budgets", async () => {
  await withConfig(
    `version: 1
mode: report
limits:
  maxChangedFiles: 0
checks:
  - name: review
    run: npm test
    whenChanged:
      - ../outside/**
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /must be repository-relative/);
    }
  );

  await withConfig(
    `version: 1
mode: report
limits:
  maxDiffBytes: 1.5
checks:
  - name: review
    run: npm test
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /must be a positive integer/);
    }
  );
});

test("configuration accepts supported blocking finding kinds", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  blockOn:
    - optional_check_failed
    - explicit_requirement_evidence_unsatisfied
`,
    async (directory) => {
      const { config } = await loadConfig(directory);
      assert.deepEqual(config.policy?.blockOn, [
        "optional_check_failed",
        "explicit_requirement_evidence_unsatisfied",
      ]);
    }
  );
});

test("configuration rejects unknown and duplicate blocking finding kinds", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  blockOn:
    - made_up_finding
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /supported finding kinds/);
    }
  );

  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  blockOn:
    - optional_check_failed
    - optional_check_failed
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /duplicate finding kinds/);
    }
  );
});

test("configuration accepts owned, reasoned, expiring warning suppressions", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  suppressions:
    - id: legacy-doc-gap
      findingId: requirement-R3
      kind: inferred_requirement_role_missing
      owner: docs-team
      reason: Migration guide is tracked in issue 123.
      expiresAt: 2026-12-31
`,
    async (directory) => {
      const { config } = await loadConfig(directory);
      assert.deepEqual(config.policy?.suppressions?.[0], {
        id: "legacy-doc-gap",
        findingId: "requirement-R3",
        kind: "inferred_requirement_role_missing",
        owner: "docs-team",
        reason: "Migration guide is tracked in issue 123.",
        expiresAt: "2026-12-31",
      });
    }
  );
});

test("configuration rejects blocker, invalid-date, and duplicate suppressions", async () => {
  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  suppressions:
    - id: hide-tests
      findingId: check-1
      kind: required_check_failed
      owner: nobody
      reason: Do not allow this.
      expiresAt: 2026-12-31
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /suppressible warning finding/);
    }
  );

  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  suppressions:
    - id: invalid-date
      findingId: requirement-R1
      kind: inferred_requirement_role_missing
      owner: docs-team
      reason: Invalid calendar date.
      expiresAt: 2026-02-31
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /valid YYYY-MM-DD date/);
    }
  );

  await withConfig(
    `version: 1
mode: report
checks:
  - name: test
    run: npm test
policy:
  suppressions:
    - id: first
      findingId: requirement-R1
      kind: inferred_requirement_role_missing
      owner: docs-team
      reason: First entry.
      expiresAt: 2026-12-31
    - id: second
      findingId: requirement-R1
      kind: inferred_requirement_role_missing
      owner: docs-team
      reason: Duplicate target.
      expiresAt: 2026-12-31
`,
    async (directory) => {
      await assert.rejects(loadConfig(directory), /target .* is duplicated/);
    }
  );
});
