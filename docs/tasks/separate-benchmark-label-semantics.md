# Separate benchmark label semantics

## Goal

Prevent external task-resolution outcomes from silently becoming semantic requirement-
omission measurements, while retaining historical corpus hashes and reproducibility.

## Requirements

1. Derive a mandatory benchmark output label semantics from corpus kind, preserving old external input bytes and rejecting conflicting semantics declarations. `change:src/review/intent-benchmark.ts`
2. Keep external proxy recall out of the calibration omission field, exposing a separate value and retaining semantics with the benchmark inputs and recall. `change:src/review/calibration.ts`
3. Emit null rates when predicted-positive or truth-label denominator classes are absent. `change:src/review/intent-evaluator.ts`
4. Verify the semantic boundary through unit tests and the standalone CLI, including historical external corpora and rejected attempts to claim adjudicated labels. `change:tests/intent-benchmark.test.ts` `change:tests/calibration.test.ts` `change:tests/intent-evaluator.test.ts` `change:scripts/verify-cli.mjs`
5. Document output fields, label classes, nullable rates, and remaining independent-adjudication work. `change:docs/CALIBRATION.md` `change:docs/EXTERNAL_CORPUS.md` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
