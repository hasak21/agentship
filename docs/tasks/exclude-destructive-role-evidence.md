# Exclude destructive and self-referential role evidence

## Requirements

1. Exclude files marked deleted by captured unified-diff metadata from inferred test/documentation role evidence, including binary deletions. Preserve explicit change and symbol semantics. `change:src/review/requirement-mapper.ts`
2. Do not let the review's own task document satisfy inferred documentation/test work, while retaining deliberately explicit path assertions. `change:src/review/review.ts`
3. Retain excluded paths in structured evidence and safely rendered Markdown. Ignore header-looking text within diff hunks as metadata. `change:src/review/types.ts` `change:src/review/review.ts` `change:src/review/requirement-mapper.ts`
4. Verify deleted-only, replacement, retained modification, binary deletion and hunk-spoofing cases; exercise working-tree, staged and base review modes and a separate four-case file-oracle corpus without replacing old baselines. `change:tests/requirement-mapper.test.ts` `change:tests/review.test.ts` `change:tests/executable-corpus.test.ts` `change:fixtures/intent/destructive-role-corpus.json`
5. Document the evidence boundary and remaining semantic-verification work. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
