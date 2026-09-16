# Map explicit requirement paths

## Objective

Create the first conservative requirement-to-change mapping layer without asking a model to guess intent.

## Requirements

1. Extract explicit path directives in `change:src/review/requirement-mapper.ts`.
2. Map exact paths and trailing directory globs through `change:src/review/requirement-mapper.ts` to observed Git evidence.
3. Preserve requirements without explicit paths as unmapped rather than inferred.
4. Emit a warning when an explicitly required path is absent through `change:src/review/review.ts`.
5. Store mapping basis, references, status, and observed files in `change:src/review/types.ts` evidence.
6. Cover observed, missing, glob, and unmapped cases in `change:tests/requirement-mapper.test.ts`.
