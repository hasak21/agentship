# Add safe local onboarding

## Requirements

1. Generate a bounded report-mode policy only from explicit npm lint/test/build scripts without overwriting existing policy in `change:src/review/onboarding.ts`.
2. Add a read-only doctor that validates configuration, isolation/resource prerequisites, effective policy hash, and direct-execution warnings.
3. Expose argument-free `init` and `doctor` commands through `change:src/cli/index.ts` and the standalone verification in `change:scripts/verify-cli.mjs`.
4. Cover initialization, overwrite refusal, missing scripts, and direct-execution diagnostics in `change:tests/onboarding.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document local-only scope and CI onboarding limitations in `change:README.md`, `change:docs/ONBOARDING.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Guessing commands for ecosystems without supported package scripts.
- Overwriting an existing policy.
- Automatically installing or enabling GitHub workflows and repository settings.
