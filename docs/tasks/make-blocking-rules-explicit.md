# Make repository blocking rules effective

Turn the existing repository-owned `policy.blockOn` declaration into enforced,
auditable review behavior.

## Requirements

1. Validate `policy.blockOn` against supported finding kinds and reject duplicates in `change:src/review/config.ts` and `change:src/review/types.ts`.
2. Promote configured finding kinds to blockers before suppression and record the effective configured list in reports via `change:src/review/review.ts`.
3. Prove configuration validation and verdict behavior in `change:tests/config.test.ts` and `change:tests/review.test.ts`; require `check:test` and `check:lint`.
4. Document the policy semantics and update development progress in `change:README.md` and `change:docs/DEVELOPMENT_PLAN.md`.
