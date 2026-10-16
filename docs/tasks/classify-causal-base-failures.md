# Classify causal base failures

## Requirements

1. Replace the broad failed/non-null-exit causal predicate with explicit base assessment that rejects zero exits, signals, ambiguous shell statuses, timeouts, resource/accounting failures and workspace cleanup failures. `change:src/review/causal-evidence.ts` `change:src/review/review.ts`
2. Record sandbox cleanup failure as structured execution evidence, preserving existing failure status. `change:src/review/runner.ts` `change:src/review/types.ts`
3. Retain the base assessment reason in JSON, blocker evidence and Markdown; recheck underlying evidence instead of trusting a precomputed satisfied flag alone. `change:src/review/review.ts` `change:src/review/types.ts`
4. Verify actual shell failures and a bubblewrap causal review where the old revision exits zero but exceeds writable storage; retain the normal nonzero base control. `change:tests/causal-evidence.test.ts` `change:tests/review.test.ts`
5. Document conservative shell-exit treatment and the remaining distinction between revision discrimination and assertion semantics. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
