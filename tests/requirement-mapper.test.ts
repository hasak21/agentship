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

test("extensionless and space-containing paths remain explicit mandates", () => {
  const mappings = mapRequirementsToChangedFiles([
    requirement("R1", "Update `change:Dockerfile`."),
    requirement("R2", "Update `change:src/my file.ts`."),
  ], []);
  assert.deepEqual(mappings.map(row => row.status), ["missing", "missing"]);
  assert.deepEqual(mappings.map(row => row.missingReferences), [["Dockerfile"], ["src/my file.ts"]]);
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
      "Change `symbol:src/auth/session.ts#refreshSession`; document ``symbol:path#name`` and ignore ``symbol:no-path``."
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

test("role inference separates implementation actions from descriptive clauses", () => {
  for (const text of [
    "Add support for the flag - documentation claims the flag already exists.",
    "Add retry handling — documentation already explains the retry policy.",
    "Update retry handling; existing tests already cover the protocol.",
    "The document describes the existing option.",
    "Refer to the document for the old behavior.",
  ]) {
    assert.deepEqual(inferExpectedFileRoles(text), [], text);
  }
});

test("role inference retains explicit actions in separate clauses", () => {
  assert.deepEqual(
    inferExpectedFileRoles("Add support for the flag; update the operator guide."),
    ["documentation"]
  );
  assert.deepEqual(
    inferExpectedFileRoles("Update retry handling — add regression tests."),
    ["test"]
  );
  assert.deepEqual(inferExpectedFileRoles("Please document the new flag."), [
    "documentation",
  ]);
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

test("deleted test and documentation paths cannot satisfy inferred additions", () => {
  const diff = `diff --git a/tests/cart.test.ts b/tests/cart.test.ts
deleted file mode 100644
--- a/tests/cart.test.ts
+++ /dev/null
@@ -1 +0,0 @@
-test('cart', () => {});
diff --git a/docs/cart.md b/docs/cart.md
deleted file mode 100644
--- a/docs/cart.md
+++ /dev/null
@@ -1 +0,0 @@
-Cart guide`;
  const [inferred, explicit] = mapRequirementsToChangedFiles([
    requirement("R1", "Add regression tests and update documentation."),
    requirement("R2", "Remove obsolete `change:tests/cart.test.ts`."),
  ], ["tests/cart.test.ts", "docs/cart.md"], [], diff);
  assert.equal(inferred.status, "inferred_missing");
  assert.deepEqual(inferred.missingRoles, ["test", "documentation"]);
  assert.ok(inferred.roleEvidence.every(row => row.observedFiles.length === 0));
  assert.deepEqual(inferred.roleEvidence[0].excludedDeletedFiles, ["tests/cart.test.ts"]);
  assert.equal(explicit.status, "observed", "explicit path changes may legitimately be deletions");
});

test("task input is not documentation evidence but explicit changes still count", () => {
  const mappings = mapRequirementsToChangedFiles([
    requirement("R1", "Update documentation."),
    requirement("R2", "Revise `change:docs/task.md`."),
  ], ["docs/task.md"], [], "", { excludedRolePaths: ["docs/task.md"] });
  assert.equal(mappings[0].status, "inferred_missing");
  assert.deepEqual(mappings[0].roleEvidence[0].excludedInputFiles, ["docs/task.md"]);
  assert.equal(mappings[1].status, "observed");
});

test("hunk content cannot masquerade as file deletion metadata", () => {
  const diff = `diff --git a/tests/example.test.ts b/tests/example.test.ts
--- a/tests/example.test.ts
+++ b/tests/example.test.ts
@@ -0,0 +1,2 @@
+++ /dev/null
+// deleted file mode 100644`;
  const [mapping] = mapRequirementsToChangedFiles([
    requirement("R1", "Add tests."),
  ], ["tests/example.test.ts"], [], diff);
  assert.equal(mapping.status, "inferred_observed");
});

test("binary deletions are excluded while replacement tests still count", () => {
  const diff = `diff --git a/tests/old.test.ts b/tests/old.test.ts
deleted file mode 100644
Binary files a/tests/old.test.ts and /dev/null differ
diff --git a/tests/new.test.ts b/tests/new.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/new.test.ts
@@ -0,0 +1 @@
+test('replacement', () => {});`;
  const [mapping] = mapRequirementsToChangedFiles([
    requirement("R1", "Add tests."),
  ], ["tests/old.test.ts", "tests/new.test.ts"], [], diff);
  assert.equal(mapping.status, "inferred_observed");
  assert.deepEqual(mapping.roleEvidence[0].observedFiles, ["tests/new.test.ts"]);
  assert.deepEqual(mapping.roleEvidence[0].excludedDeletedFiles, ["tests/old.test.ts"]);
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
