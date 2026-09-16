import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPathReferences,
  mapRequirementsToChangedFiles,
  summarizeChangeCoverage,
} from "../src/review/requirement-mapper";

const requirement = (id: string, text: string) => ({
  id,
  text,
  line: 1,
  confirmation: "not_required" as const,
});

test("extracts only explicit change annotations", () => {
  assert.deepEqual(
    extractPathReferences(
      "Update `change:src/auth/session.ts`; `src/auth/types.ts` is context."
    ),
    ["src/auth/session.ts"]
  );
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
  assert.deepEqual(mappings[1].observedFiles, ["tests/auth/session.test.ts"]);
  assert.equal(mappings[2].status, "unmapped");
});

test("marks an explicitly named but unchanged path as missing", () => {
  const [mapping] = mapRequirementsToChangedFiles(
    [requirement("R1", "Update `change:src/payments/charge.ts`.")],
    ["src/payments/refund.ts"]
  );
  assert.equal(mapping.status, "missing");
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
