# Infer required test and documentation files

## Objective

Detect conservative prose-only test and documentation omissions while preserving the distinction between inferred and observed evidence.

## Requirements

1. Infer test and documentation roles only from bounded imperative patterns in `change:src/review/requirement-mapper.ts`.
2. Suppress common negated requests and avoid duplicating equivalent explicit path evidence.
3. Record inferred roles, matching changed files, missing roles, and `inferred_*` statuses in `change:src/review/types.ts` and `change:src/review/review.ts`.
4. Emit warning-level inferred findings without producing a blocking verdict.
5. Cover observed, missing, negated, and explicit-path cases in `change:tests/requirement-mapper.test.ts`, `change:tests/review.test.ts`, and `change:fixtures/intent/explicit-evidence-cases.json`.
6. Re-measure the independently labeled corpus in `change:tests/intent-evaluator.test.ts` and require `check:test` and `check:lint`.
7. Document heuristic limitations and updated baseline metrics in `change:docs/TRUST_MODEL.md`.

## Out of scope

- Behavioral semantic inference.
- Treating inferred evidence as a blocker or proof of adequate tests/documentation.
