# Separate descriptive role mentions from requested changes

## Goal

Repair a reproducible external-pilot false flag without overstating small-sample results
or replacing the original baseline after observing its failures.

## Requirements

1. Keep action verbs and inferred test/documentation targets within one prose clause, and distinguish the noun document from a documentation command. `change:src/review/requirement-mapper.ts`
2. Cover descriptive mentions and real requests with regression cases; preserve existing synthetic baselines. `change:tests/requirement-mapper.test.ts`
3. Emit null precision when no findings exist instead of a misleading perfect score. `change:src/review/intent-evaluator.ts` `change:tests/intent-evaluator.test.ts`
4. Keep the original pilot summary and add a preselected disjoint holdout partition, source hashes, and complete post-repair results. `change:scripts/collect-swebench-sample.py` `change:docs/benchmarks/swebench-clause-aware-20261016.json`
5. Describe development tuning, holdout limits, unresolved-task proxy labels, and remaining semantic blind spots. `change:docs/EXTERNAL_CORPUS.md` `change:docs/CALIBRATION.md` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
