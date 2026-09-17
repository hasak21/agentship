import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCheckReferences,
  extractPathReferences,
  extractSymbolReferences,
  inferExpectedFileRoles,
  mapRequirementsToChangedFiles,
  summarizeChangeCoverage,
} from "../src/review/requirement-mapper";

const requirement = (id: string, text: string) => ({
  id,
  text,
  line: 1,
  confirmation: "not_required" as const,
  confirmationBasis: [],
});

test("extracts only explicit change annotations", () => {
  assert.deepEqual(
    extractPathReferences(
      "Update `change:src/auth/session.ts`; `src/auth/types.ts` is context; document ``change:path``."
    ),
    ["src/auth/session.ts"]
  );
});

test("extracts explicit check annotations without treating ordinary code as evidence", () => {
  assert.deepEqual(
    extractCheckReferences(
      "Run `check:test`, preserve `npm test`, and document ``check:name``."
    ),
    ["test"]
  );
});

test("extracts path-qualified symbol annotations only", () => {
  assert.deepEqual(
    extractSymbolReferences(
      "Change `symbol:src/auth/session.ts#refreshSession`; document ``symbol:path#name`` and ignore `symbol:no-path`."
    ),
    [{ path: "src/auth/session.ts", symbol: "refreshSession" }]
  );
});

test("infers conservative test and documentation roles with negation controls", () => {
  assert.deepEqual(inferExpectedFileRoles("Add regression tests for refresh."), [
    "test",
  ]);
  assert.deepEqual(inferExpectedFileRoles("Update the operator guide."), [
    "documentation",
  ]);
  assert.deepEqual(
    inferExpectedFileRoles("Update the handler without changing tests or docs."),
    []
  );
  assert.deepEqual(inferExpectedFileRoles("Do not document this option."), []);
  assert.deepEqual(inferExpectedFileRoles("Preserve existing tests."), []);
});

test("maps exact paths and directory globs to observed changed files", () => {
  const mappings = mapRequirementsToChangedFiles(
    [
      requirement("R1", "Update `change:src/auth/session.ts`."),
      requirement("R2", "Cover `change:tests/auth/**`."),
      requirement("R3", "Preserve compatibility."),
    ],
    ["src/auth/session.ts", "tests/auth/session.test.ts"]
  );

  assert.equal(mappings[0].status, "observed");
  assert.deepEqual(mappings[0].missingReferences, []);
  assert.deepEqual(mappings[1].observedFiles, ["tests/auth/session.test.ts"]);
  assert.equal(mappings[2].status, "unmapped");
});

test("marks an explicitly named but unchanged path as missing", () => {
  const [mapping] = mapRequirementsToChangedFiles(
    [requirement("R1", "Update `change:src/payments/charge.ts`.")],
    ["src/payments/refund.ts"]
  );
  assert.equal(mapping.status, "missing");
  assert.deepEqual(mapping.missingReferences, ["src/payments/charge.ts"]);
});

test("marks a multi-path requirement missing when any required path is absent", () => {
  const [mapping] = mapRequirementsToChangedFiles(
    [
      requirement(
        "R1",
        "Update `change:src/auth/session.ts` and `change:tests/auth/session.test.ts`."
      ),
    ],
    ["src/auth/session.ts"]
  );

  assert.equal(mapping.status, "missing");
  assert.deepEqual(mapping.observedFiles, ["src/auth/session.ts"]);
  assert.deepEqual(mapping.missingReferences, ["tests/auth/session.test.ts"]);
});

test("maps named checks to their observed execution status", () => {
  const mappings = mapRequirementsToChangedFiles(
    [
      requirement("R1", "Pass `check:test`."),
      requirement("R2", "Pass `check:integration`."),
      requirement("R3", "Change `change:src/auth/session.ts` and pass `check:lint`."),
      requirement("R4", "Pass `check:e2e`."),
    ],
    ["src/auth/session.ts"],
    [
      { name: "test", status: "passed" },
      { name: "lint", status: "failed" },
      { name: "e2e", status: "skipped" },
    ]
  );

  assert.equal(mappings[0].status, "observed");
  assert.equal(mappings[0].basis, "explicit_check");
  assert.deepEqual(mappings[0].checkEvidence, [{ name: "test", status: "passed" }]);
  assert.equal(mappings[1].status, "missing");
  assert.deepEqual(mappings[1].checkEvidence, [
    { name: "integration", status: "not_configured" },
  ]);
  assert.equal(mappings[2].basis, "explicit_path_and_check");
  assert.equal(mappings[2].status, "missing");
  assert.deepEqual(mappings[2].checkEvidence, [{ name: "lint", status: "failed" }]);
  assert.equal(mappings[3].status, "missing");
  assert.deepEqual(mappings[3].checkEvidence, [{ name: "e2e", status: "skipped" }]);
});

test("maps explicit symbols to added or deleted diff lines", () => {
  const diff = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,2 +1,2 @@
-export function oldSession() {}
+export function refreshSession() {}`;
  const mappings = mapRequirementsToChangedFiles(
    [
      requirement("R1", "Change `symbol:src/auth/session.ts#refreshSession`."),
      requirement("R2", "Change `symbol:src/auth/session.ts#rotateKey`."),
      requirement("R3", "Change `symbol:src/new.ts#createThing`."),
    ],
    ["src/auth/session.ts", "src/new.ts"],
    [],
    diff
  );

  assert.equal(mappings[0].basis, "explicit_symbol");
  assert.equal(mappings[0].status, "observed");
  assert.deepEqual(mappings[0].symbolEvidence, [
    { path: "src/auth/session.ts", symbol: "refreshSession", status: "changed" },
  ]);
  assert.equal(mappings[1].status, "missing");
  assert.equal(mappings[1].symbolEvidence[0].status, "symbol_not_in_diff");
  assert.equal(mappings[2].symbolEvidence[0].status, "diff_unavailable");
});

test("labels inferred file-role evidence separately from explicit evidence", () => {
  const mappings = mapRequirementsToChangedFiles(
    [
      requirement("R1", "Add regression tests for refresh."),
      requirement("R2", "Update the operator guide."),
      requirement("R3", "Document the option in `change:docs/configuration.md`."),
    ],
    ["tests/auth/refresh.test.ts", "src/config.ts"]
  );

  assert.equal(mappings[0].basis, "inferred_file_role");
  assert.equal(mappings[0].status, "inferred_observed");
  assert.deepEqual(mappings[0].roleEvidence, [
    { role: "test", observedFiles: ["tests/auth/refresh.test.ts"] },
  ]);
  assert.equal(mappings[1].status, "inferred_missing");
  assert.deepEqual(mappings[1].missingRoles, ["documentation"]);
  assert.equal(mappings[2].basis, "explicit_path");
  assert.deepEqual(mappings[2].inferredRoles, []);
});

test("reports changed files without explicit requirement attribution", () => {
  const mappings = mapRequirementsToChangedFiles(
    [requirement("R1", "Update `change:src/review/review.ts`.")],
    ["src/review/review.ts", "README.md"]
  );

  assert.deepEqual(
    summarizeChangeCoverage(mappings, ["src/review/review.ts", "README.md"]),
    {
      attributedFiles: ["src/review/review.ts"],
      unattributedFiles: ["README.md"],
    }
  );
});

test("change coverage excludes the task input itself", () => {
  const mappings = mapRequirementsToChangedFiles(
    [requirement("R1", "Update `change:src/review/review.ts`.")],
    ["src/review/review.ts", "docs/task.md", "README.md"]
  );

  assert.deepEqual(
    summarizeChangeCoverage(
      mappings,
      ["src/review/review.ts", "docs/task.md", "README.md"],
      ["docs/task.md"]
    ),
    {
      attributedFiles: ["src/review/review.ts"],
      unattributedFiles: ["README.md"],
    }
  );
});
