# Add hash-bound override records

Record exceptional human decisions without erasing findings or accepting a
free-form bypass flag.

## Requirements

1. Parse bounded override records and bind them to a prior report plus the current head, diff, configuration, task, and finding identities in `change:src/review/override.ts` and `change:src/review/types.ts`.
2. Apply valid overrides to verdicts while retaining JSON, Markdown, and SARIF evidence through `change:src/review/review.ts`.
3. Expose `--override` through `change:src/cli/index.ts` and the standalone verifier in `change:scripts/verify-cli.mjs`.
4. Cover valid, expired, tampered, stale-binding, forbidden-kind, and absent-target behavior in `change:tests/override.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document the workflow and unauthenticated-actor boundary in `change:README.md`, `change:docs/OVERRIDES.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
6. Keep locally created override inputs outside the reviewed diff through `change:.gitignore`.
