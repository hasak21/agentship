import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskRequirements } from "../src/review/task-parser";

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
      confirmation: "explicit",
    },
    {
      id: "R2",
      text: "Preserve existing session cookies.",
      line: 10,
      confirmation: "explicit",
    },
  ]);
});

test("task parser does not treat numbered lists outside Requirements as requirements", () => {
  assert.deepEqual(
    parseTaskRequirements(`# Task\n\n## Notes\n\n1. This is only context.\n`),
    []
  );
});
