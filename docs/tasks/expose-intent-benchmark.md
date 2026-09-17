# Expose the intent benchmark

## Objective

Make omission metrics independently runnable, corpus-bound, and inspectable case by case.

## Requirements

1. [confirm] Validate corpora, compute per-case outcomes, bind source hashes, and expose the benchmark through the CLI across `change:src/review/**`, `change:src/cli/index.ts`, and `change:package.json`.
2. Cover valid metrics, exact misclassified IDs, malformed cases, and duplicate IDs in `change:tests/**`; require `check:test` and `check:lint`.
3. Verify the standalone executable can benchmark an explicitly supplied corpus through `change:scripts/verify-cli.mjs` and require `check:cli-package`.
4. Document benchmark usage and non-representative limitations in `change:docs/**` and `change:README.md`.

## Out of scope

- Claiming publishable real-world accuracy from the eight-case corpus.
- Downloading or silently selecting a corpus.
