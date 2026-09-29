# Measure calibration metrics

Aggregate review, finding-outcome, and executable benchmark evidence into reproducible
trust metrics without silently inventing missing denominators.

## Requirements

1. Compute precision, omission recall, false blocks per 100 reviews, median triage time, and override follow-up from bounded evidence sets in `change:src/review/calibration.ts`.
2. Bind every metric run to aggregate input hashes, require outcome source reports in the review denominator, group lifecycle events by exact finding identity, and reject conflicting dispositions in `change:src/review/calibration.ts`.
3. Expose metrics through `change:src/cli/index.ts` and verify the standalone command through `change:scripts/verify-cli.mjs`.
4. Cover metric arithmetic, lifecycle grouping, source tampering, conflicts, and path/input bounds in `change:tests/calibration.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document formulas, null/insufficient samples, provenance limits, and benchmark representativeness in `change:README.md`, `change:docs/CALIBRATION.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
