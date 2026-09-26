# Measure finding outcomes

## Objective

Turn retained finding outcomes into reproducible calibration metrics without claiming
recall or provenance that the records cannot establish.

## Requirements

1. Validate and aggregate bounded outcome files from a repository-relative directory.
2. Report disposition precision and coverage, rejected blocker rate, median/p90 triage time, and false-blocked reviews per 100 hash-verified review reports.
3. Reject duplicate dispositions for the same source-report finding.
4. Expose JSON metrics through the standalone CLI and document metric limitations.
5. Cover aggregation, empty inputs, duplicates, and malformed events in tests.

## Out of scope

- Measuring recall from outcome events that contain no missed-finding labels.
- Treating local actor strings or records as authenticated provenance.
- Treating a partial review directory as a complete organizational denominator.
