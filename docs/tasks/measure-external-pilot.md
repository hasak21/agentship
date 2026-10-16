# Measure an external public-artifact pilot

## Goal

Move external-corpus collection beyond fabricated examples, retaining unfavorable results
and the distinction between task-resolution outcomes and semantic requirement omissions.

## Requirements

1. Collect independently produced public candidates from immutable dataset/submission revisions with a repository-stratified identity-only selection fixed before reading outcomes. Never execute candidate code. `change:scripts/collect-swebench-sample.py`
2. Retain source-byte hashes and a result summary with every selected instance, patch/report digests, confusion counts, and detector revision. `change:docs/benchmarks/swebench-stratified-20261016.json`
3. Run the existing importer and benchmark unchanged on the collected sample, preserving complete and incomplete outcomes and any detector failures.
4. Record exact reproduction commands, proxy-label limits, observed blind spots, and the need for an independent holdout before tuning. `change:docs/EXTERNAL_CORPUS.md` `change:docs/CALIBRATION.md` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
