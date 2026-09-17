# Seed an omission-detection baseline

## Objective

Measure known limitations of deterministic requirement evidence without presenting annotation accuracy as semantic recall.

## Requirements

1. Add independently labeled omission and complete-change scenarios in `change:fixtures/intent/seeded-omission-cases.json`.
2. Include explicit path, explicit check, prose-only semantic, and stale-annotation cases.
3. Compute true positives, true negatives, false positives, false negatives, precision, recall, accuracy, and false-positive rate in `change:src/review/intent-evaluator.ts`.
4. Lock the baseline metrics with `change:tests/intent-evaluator.test.ts` and require `check:test`.
5. Record the corpus limitations and measured blind spots in `change:docs/TRUST_MODEL.md`.

## Out of scope

- Claims of representative real-world performance.
- Executable before-and-after patch fixtures.
