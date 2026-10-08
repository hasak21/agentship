# Add reproducible agent leaderboard compilation

## Requirements

1. Validate bounded, hash-bound agent evaluation manifests and referenced reports in `change:src/review/leaderboard.ts`.
2. Require identical suite provenance, task identities, and task hashes before deterministic ranking; retain explicit authenticity and representativeness limitations.
3. Expose `leaderboard --submissions` through `change:src/cli/index.ts` and prove it works from the standalone bundle in `change:scripts/verify-cli.mjs`.
4. Cover ranking, tampering, and incomparable inputs in `change:tests/leaderboard.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document the submission format and roadmap status in `change:README.md`, `change:docs/LEADERBOARD.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming the checked-in synthetic corpus represents real agent performance.
- Authenticating unsigned reports or self-declared agent/model names.
- Publishing a hosted leaderboard without independently collected submissions.
