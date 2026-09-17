# Map explicit symbols to diff evidence

## Objective

Bind path-qualified symbol expectations to captured changed lines without claiming semantic code understanding.

## Requirements

1. Parse exact ``symbol:path#identifier`` annotations in `change:src/review/requirement-mapper.ts`.
2. Match symbols only against added or deleted lines in the captured unified diff using `symbol:src/review/requirement-mapper.ts#mapSymbolEvidence`.
3. Distinguish changed symbols, unchanged files, absent symbols, and unavailable diff content in `change:src/review/types.ts` and `change:src/review/review.ts`.
4. Emit warning-level evidence for unsatisfied symbol annotations.
5. Cover parsing, changed, absent, unavailable, and finding cases in `change:tests/requirement-mapper.test.ts`, `change:tests/review.test.ts`, and `change:fixtures/intent/explicit-evidence-cases.json`; require `check:test` and `check:lint`.
6. Document token-matching and untracked/binary limitations in `change:docs/TRUST_MODEL.md`.

## Out of scope

- Language-aware symbol resolution.
- Proving semantic correctness from a token match.
