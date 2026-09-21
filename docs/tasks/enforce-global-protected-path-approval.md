# Enforce global protected-path approval

Close the task-annotation bypass by applying protected-path policy to every
observed changed file.

## Requirements

1. Evaluate configured protected paths globally, emit blockers for missing approval, and bind approval evidence into reports across `change:src/review/**`.
2. Add repeatable exact-pattern approval to `change:src/cli/index.ts` and verify it remains present in the standalone artifact through `change:scripts/verify-cli.mjs`.
3. Cover exact matching, unmatched policy, invalid approval, duplicate policy, missing approval, and confirmed approval in `change:tests/**`; require `check:test`, `check:lint`, and `check:cli-package`.
4. Document semantics, limitations, and milestone progress in `change:README.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
