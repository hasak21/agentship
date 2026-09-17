# Measure explicit-path omission mapping

## Objective

Establish a reproducible fixture baseline for the deterministic requirement-path mapping layer without representing it as semantic intent accuracy.

## Requirements

1. Store observed, missing, glob, contextual-path, and unmapped cases in `change:fixtures/intent/explicit-evidence-cases.json`.
2. Compute accuracy, missing precision, missing recall, false positives, and false negatives in `change:src/review/intent-evaluator.ts`.
3. Exercise the checked-in corpus through `change:tests/intent-evaluator.test.ts`.
4. Keep the metric scope explicitly limited to annotated path mapping.
5. Require perfect results on the deterministic fixture set.
