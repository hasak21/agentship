import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mapRequirementsToChangedFiles } from "../src/review/requirement-mapper";
import {
  applyRequirementConfirmations,
  MAX_TASK_DOCUMENT_BYTES,
  MAX_TASK_REQUIREMENTS,
  parseTaskOptions,
  parseTaskRequirements,
  readBoundedTaskDocument,
} from "../src/review/task-parser";

interface AdversarialTaskCase {
  id: string;
  markdown: string;
  expected?: Array<{
    id: string;
    text: string;
    line: number;
    confirmation: "not_required" | "required";
  }>;
  strictChangeCoverage?: boolean;
  error?: string;
}

test("task parser extracts numbered requirements with stable source lines", () => {
  const markdown = `# Change session behavior

## Objective

Repair refresh handling.

## Requirements

1. Reject expired refresh tokens.
2) Preserve existing session cookies.

## Out of scope

1. Redesign authentication.
`;

  assert.deepEqual(parseTaskRequirements(markdown), [
    {
      id: "R1",
      text: "Reject expired refresh tokens.",
      line: 9,
      confirmation: "not_required",
      confirmationBasis: [],
    },
    {
      id: "R2",
      text: "Preserve existing session cookies.",
      line: 10,
      confirmation: "not_required",
      confirmationBasis: [],
    },
  ]);
});

test("task parser retains wrapped requirement clauses for evidence mapping", () => {
  const requirements = parseTaskRequirements("## Requirements\n1. Implement the behavior.\n   Add regression tests in `change:tests/cart.test.ts`.\n   Pass `check:test`.\n2. Preserve compatibility.\n");
  assert.equal(requirements.length, 2);
  assert.equal(requirements[0].text, "Implement the behavior.\nAdd regression tests in `change:tests/cart.test.ts`.\nPass `check:test`.");
  assert.equal(requirements[0].line, 2);
  assert.equal(requirements[1].line, 5);
  const [mapping] = mapRequirementsToChangedFiles(requirements, [], [{ name: "test", status: "failed" }]);
  assert.equal(mapping.status, "missing");
  assert.deepEqual(mapping.missingReferences, ["tests/cart.test.ts"]);
  assert.deepEqual(mapping.checkEvidence, [{ name: "test", status: "failed" }]);
});

test("nested numbered and bullet clauses remain attached to their parent requirement", () => {
  const requirements = parseTaskRequirements("## Requirements\n1. [confirm] Update the API.\n   1. Preserve `symbol:src/api.ts#handler`.\n   - Add regression tests.\n\n   Update documentation.\n2. Preserve compatibility.\n");
  assert.deepEqual(requirements.map(row => row.id), ["R1", "R2"]);
  assert.equal(requirements[0].confirmation, "required");
  assert.equal(requirements[0].line, 2);
  const [mapping] = mapRequirementsToChangedFiles(requirements, ["src/api.ts"]);
  assert.equal(mapping.status, "missing");
  assert.equal(mapping.symbolEvidence[0].symbol, "handler");
  assert.deepEqual(mapping.missingRoles, ["test", "documentation"]);
});

test("continuation indentation accounts for marker width and tab stops", () => {
  const requirements = parseTaskRequirements("## Requirements\n10. Update the API.\n    Add tests.\n11. Preserve compatibility.\n\tUpdate docs.\n");
  assert.match(requirements[0].text, /Add tests/);
  assert.match(requirements[1].text, /Update docs/);
  assert.throws(() => parseTaskRequirements("## Requirements\n10. Update API.\n   Add tests.\n"), /must align/);
});

test("continuations do not absorb outside prose, other sections or fenced examples", () => {
  const requirements = parseTaskRequirements(`## Requirements
1. Update API.
   \`\`\`markdown
   1. Fake \`change:fake.ts\`.
   \`\`\`
   Add tests.
Notes outside the list.
   Update docs.
2. Preserve compatibility.
## Notes
   Write documentation.
1. Not a requirement.
`);
  assert.equal(requirements.length, 2);
  assert.equal(requirements[0].text, "Update API.\nAdd tests.");
  assert.equal(requirements[1].text, "Preserve compatibility.");
});

test("combined continuation text is subject to the per-requirement byte limit", () => {
  assert.throws(() => parseTaskRequirements(`## Requirements\n1. ${"x".repeat(8192)}\n   ${"é".repeat(4096)}\n`), /at most 16384 bytes/);
  assert.deepEqual(parseTaskRequirements("## Requirements\n    1. Indented code outside a parent.\n"), []);
});

test("task parser marks confirmation requirements and applies operator confirmation", () => {
  const requirements = parseTaskRequirements(
    "## Requirements\n\n1. [confirm] Rotate the production signing key.\n"
  );
  assert.equal(requirements[0].confirmation, "required");
  assert.deepEqual(requirements[0].confirmationBasis, ["task_marker"]);
  assert.equal(requirements[0].text, "Rotate the production signing key.");
  assert.equal(
    applyRequirementConfirmations(requirements, ["R1"])[0].confirmation,
    "confirmed"
  );
  assert.throws(
    () => applyRequirementConfirmations(requirements, ["R9"]),
    /Unknown requirement confirmation/
  );
});

test("protected-path requirements require confirmation with a recorded basis", () => {
  const requirements = parseTaskRequirements(
    "## Requirements\n\n1. Update the payment handler.\n"
  );
  const pending = applyRequirementConfirmations(requirements, [], ["R1"]);
  assert.equal(pending[0].confirmation, "required");
  assert.deepEqual(pending[0].confirmationBasis, ["protected_path"]);

  const confirmed = applyRequirementConfirmations(requirements, ["R1"], ["R1"]);
  assert.equal(confirmed[0].confirmation, "confirmed");
  assert.deepEqual(confirmed[0].confirmationBasis, ["protected_path"]);
});

test("task parser does not treat numbered lists outside Requirements as requirements", () => {
  assert.deepEqual(
    parseTaskRequirements(`# Task\n\n## Notes\n\n1. This is only context.\n`),
    []
  );
});

test("task options enable strict change coverage only through an exact directive", () => {
  assert.deepEqual(
    parseTaskOptions("<!-- agentship: strict-change-coverage -->\n# Task\n"),
    { strictChangeCoverage: true }
  );
  assert.deepEqual(parseTaskOptions("Mention strict-change-coverage in prose."), {
    strictChangeCoverage: false,
  });
});

test("unterminated fences cannot silently remove subsequent task requirements", () => {
  for (const opening of ["```markdown", "~~~~", "   ```"]) {
    const markdown = `## Requirements\n1. Update API.\n${opening}\n2. Add regression tests.\n`;
    assert.throws(() => parseTaskRequirements(markdown), /Unclosed task code fence at line 3/);
    assert.throws(() => parseTaskOptions(markdown), /Unclosed task code fence at line 3/);
  }
});

test("strict coverage directives do not bypass full task fence validation", () => {
  const markdown = "<!-- agentship: strict-change-coverage -->\n## Requirements\n1. Update API.\n````\n```\n~~~\n2. Add tests.\n";
  assert.throws(() => parseTaskOptions(markdown), /Unclosed task code fence at line 4/);
  assert.throws(() => parseTaskRequirements(markdown), /Unclosed task code fence at line 4/);
});

test("matching longer fences close examples and preserve following requirement source lines", () => {
  const markdown = "## Requirements\n1. Update API.\n~~~text\n2. Example only.\n~~~~\n2. Add tests.\n";
  assert.deepEqual(parseTaskRequirements(markdown).map(({ id, line }) => ({ id, line })), [
    { id: "R1", line: 2 }, { id: "R2", line: 6 },
  ]);
  assert.equal(parseTaskOptions(markdown).strictChangeCoverage, false);
});

test("adversarial task corpus keeps hostile content as data and rejects ambiguity", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/adversarial/task-input-cases.json", import.meta.url),
      "utf8"
    )
  ) as AdversarialTaskCase[];
  for (const entry of fixture) {
    if (entry.error) {
      assert.throws(
        () => parseTaskRequirements(entry.markdown),
        new RegExp(entry.error),
        entry.id
      );
      continue;
    }
    if (entry.expected) {
      assert.deepEqual(
        parseTaskRequirements(entry.markdown).map(
          ({ id, text, line, confirmation }) => ({ id, text, line, confirmation })
        ),
        entry.expected,
        entry.id
      );
    }
    if (entry.strictChangeCoverage !== undefined) {
      assert.equal(
        parseTaskOptions(entry.markdown).strictChangeCoverage,
        entry.strictChangeCoverage,
        entry.id
      );
    }
  }
});

test("task parser bounds document bytes, requirement count, and requirement text", () => {
  assert.throws(
    () => parseTaskRequirements("x".repeat(MAX_TASK_DOCUMENT_BYTES + 1)),
    /Task document exceeds/
  );
  const tooMany = Array.from(
    { length: MAX_TASK_REQUIREMENTS + 1 },
    (_, index) => `${index + 1}. Requirement ${index + 1}.`
  ).join("\n");
  assert.throws(
    () => parseTaskRequirements(`## Requirements\n${tooMany}\n`),
    /exceeds 256 requirements/
  );
  assert.throws(
    () => parseTaskRequirements(`## Requirements\n1. ${"é".repeat(8193)}\n`),
    /at most 16384 bytes/
  );
});

test("task reader rejects oversized and non-regular files before parsing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-task-input-"));
  try {
    const oversized = path.join(directory, "oversized.md");
    await writeFile(oversized, Buffer.alloc(MAX_TASK_DOCUMENT_BYTES + 1, 0x20));
    await assert.rejects(readBoundedTaskDocument(oversized), /regular file of at most/);

    const nested = path.join(directory, "directory.md");
    await mkdir(nested);
    await assert.rejects(readBoundedTaskDocument(nested), /regular file of at most/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
