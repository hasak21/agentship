import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRequirementConfirmations,
  parseTaskOptions,
  parseTaskRequirements,
} from "../src/review/task-parser";

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
