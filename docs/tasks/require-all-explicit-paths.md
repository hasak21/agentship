# Require all explicit paths

## Objective

Prevent a partially implemented multi-path requirement from being reported as observed.

## Requirements

1. Require every explicit path reference to match the changed-file set in `change:src/review/requirement-mapper.ts`.
2. Record unmatched references in the evidence schema and report in `change:src/review/types.ts` and `change:src/review/review.ts`.
3. Use only unmatched references as finding evidence.
4. Add unit and fixture coverage for a partially observed multi-path requirement in `change:tests/requirement-mapper.test.ts`, `change:fixtures/intent/explicit-evidence-cases.json`, and `change:tests/intent-evaluator.test.ts`.
5. Document the all-references invariant in `change:docs/TRUST_MODEL.md`.
