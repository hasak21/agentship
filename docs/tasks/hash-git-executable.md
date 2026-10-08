# Hash the Git evidence executable

Bind repository evidence to the exact canonical Git executable bytes and reject incomplete
official reports without claiming that a digest authenticates the host package.

## Requirements

1. [confirm] Hash the bounded canonical Git executable through stable file handles before and after version execution in `change:src/review/git.ts`, retain byte length and SHA-256 in `change:src/review/types.ts`, and fail closed if provenance changes during review in `change:src/review/review.ts`.
2. Render Git byte provenance in Markdown and cover generated evidence in `change:tests/git.test.ts` and `change:tests/review.test.ts`; require `check:test` and `check:lint`.
3. Verify standalone output and require bounded Git provenance in privileged publication through `change:scripts/verify-cli.mjs`, `change:scripts/build-check-run.mjs`, and `change:tests/check-publisher.test.ts`; require `check:cli-package`.
4. Document byte identity versus host/package authentication and update the roadmap in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Authenticating the host administrator, operating-system package database, or Git vendor.
- Proving reproducible Git builds or collecting shared-library provenance.
- Replacing signed runner or workload attestation.
