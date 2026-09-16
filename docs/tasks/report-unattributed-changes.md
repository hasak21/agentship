# Report unattributed changes

## Objective

Expose reverse requirement coverage without making unsupported semantic claims.

## Requirements

1. Compute attributed and unattributed changed files in `change:src/review/requirement-mapper.ts`.
2. Include change coverage in the evidence schema and review report in `change:src/review/types.ts` and `change:src/review/review.ts`.
3. State clearly that unattributed does not mean unrelated in `change:docs/TRUST_MODEL.md`.
4. Cover reverse mapping deterministically in `change:tests/requirement-mapper.test.ts`.

## Out of scope

- Semantic relevance classification.
- Blocking or warning on unattributed files.
