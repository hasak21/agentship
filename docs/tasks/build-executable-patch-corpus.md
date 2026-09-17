# Build an executable patch corpus

## Objective

Derive benchmark outcomes from applied before/after file states and independently executed safe oracles instead of copied expected labels.

## Requirements

1. [confirm] Validate bounded declarative patch cases, derive changed paths and line-level diffs, and execute only safe file oracles throughout `change:src/review/**`.
2. Support the executable corpus in the existing benchmark command and primary npm script through `change:src/cli/index.ts` and `change:package.json`.
3. Seed security, tests, documentation, symbols, checks, stale annotations, and unconventional layouts in `change:fixtures/intent/executable-patch-corpus.json`.
4. Cover oracle-derived outcomes, exact aggregate metrics, known errors, unsafe paths, and rejected arbitrary oracle types in `change:tests/**`; require `check:test` and `check:lint`.
5. Verify the standalone bundle executes the primary corpus through `change:scripts/verify-cli.mjs` and require `check:cli-package`.
6. Record lower executable-corpus metrics and their limitations in `change:docs/**` and `change:README.md`.

## Out of scope

- Executing arbitrary commands supplied by a corpus.
- Claiming representative real-world accuracy from 12 synthetic cases.
