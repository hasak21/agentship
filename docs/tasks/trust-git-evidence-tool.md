# Trust the Git evidence tool

Prevent repository packages from replacing the Git executable before AgentShip captures
the head, changed files, or diff.

## Requirements

1. [confirm] Resolve Git from canonical host locations or sanitized absolute fallback paths, reject repository and `node_modules/.bin` candidates after symlink resolution, and fail closed in `change:src/review/git.ts`.
2. [confirm] Retain the canonical Git path and bounded version string as report provenance in `change:src/review/types.ts` and `change:src/review/review.ts`.
3. Prove repository-controlled replacement resistance, fail-closed behavior, and generated-report provenance in `change:tests/git.test.ts` and `change:tests/review.test.ts`; require `check:test` and `check:lint`.
4. Document the resolved threat and remaining host/signature boundary in `change:README.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Authenticating the host administrator or operating-system package database.
- Signing reports or hashing the Git executable in this slice.
- Executing repository-supplied Git wrappers or hooks.
