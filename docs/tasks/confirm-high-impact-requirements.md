# Confirm high-impact requirements

## Objective

Make explicit operator confirmation a deterministic gate input without presenting it as authenticated approval.

## Requirements

1. [confirm] Use a task marker to require operator confirmation in `change:src/review/task-parser.ts`.
2. Accept stable requirement IDs through `--confirm` in `change:src/cli/index.ts`.
3. Produce a blocker while a required confirmation is absent in `change:src/review/review.ts`.
4. Record confirmation state in the JSON and Markdown evidence model in `change:src/review/types.ts`.
5. Reject unknown requirement IDs before executing configured checks.
6. Cover parsing and verdict behavior in `change:tests/task-parser.test.ts` and `change:tests/review.test.ts`.

## Out of scope

- Automatic ambiguity or impact classification.
- Authentication, signatures, and multi-user approval policy.
