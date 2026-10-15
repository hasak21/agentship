# External intent corpus contract

AgentShip distinguishes externally evaluated candidate patches from synthetic regression
fixtures with the `external_evaluation` corpus kind. The distinction is evidence: a JSON
file does not become representative merely because it contains repository names.

The intended first source is
[SWE-bench Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified), a
human-reviewed set of real GitHub issue and pull-request pairs. Its dataset card describes
500 Python tasks with issue text, base commits, gold patches, test patches, and
test-derived evaluation fields. AgentShip does not copy that dataset, execute its code, or
equate a gold patch with an independently evaluated agent candidate.

## Schema

```json
{
  "schemaVersion": 1,
  "kind": "external_evaluation",
  "provenance": {
    "dataset": "SWE-bench/SWE-bench_Verified",
    "revision": "FULL_40_CHARACTER_COMMIT_OR_64_CHARACTER_DIGEST",
    "datasetSha256": "SHA256_OF_EXACT_DATASET_EXPORT_BYTES",
    "predictionsSha256": "SHA256_OF_EXACT_PREDICTIONS_FILE_BYTES",
    "split": "test",
    "sourceUrl": "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
    "selection": "Published deterministic sampling procedure.",
    "retrievedAt": "2026-10-10"
  },
  "cases": [
    {
      "id": "stable-local-case-id",
      "category": "externally evaluated candidate",
      "requirement": "Exact task text supplied to the candidate.",
      "changedFiles": ["repository/relative/path.py"],
      "diff": "candidate unified diff",
      "omissionExpected": true,
      "rationale": "Why the external outcome represents an incomplete task.",
      "source": {
        "instanceId": "owner__repository-123",
        "repository": "owner/repository",
        "baseCommit": "FULL_40_CHARACTER_BASE_COMMIT",
        "candidate": "model-or-agent/run-id",
        "predictionSha256": "SHA256_OF_EXACT_MODEL_PATCH_BYTES",
        "outcomeSha256": "SHA256_OF_EXACT_REPORT_JSON_BYTES",
        "outcomeEvidence": "https://credential-free.example/evaluation/result"
      }
    }
  ]
}
```

`benchmark --fixtures` rejects mutable dataset revisions, non-HTTPS or credential-bearing
source links, abbreviated base commits, invalid evidence hashes, incomplete source records,
duplicate case IDs, and duplicate instance/candidate pairs. Direct library calls and the
CLI both enforce a 5 MiB corpus bound. Benchmark and calibration output retain corpus-level
provenance; benchmark output also retains each case's source identity alongside the
detector result.

## Import official SWE-bench evidence

The official harness accepts prediction JSONL and writes a per-instance `report.json`.
Its submission packager produces `all_preds.jsonl` plus
`logs/<instance_id>/report.json`. AgentShip imports that packaged layout locally:

```bash
agentship import-swebench \
  --dataset verified-test.jsonl \
  --predictions submission/all_preds.jsonl \
  --reports submission/logs \
  --candidate-run public-run-id \
  --evidence-base-url https://github.com/OWNER/RESULTS/blob/FULL_COMMIT_SHA/ \
  --dataset-name SWE-bench/SWE-bench_Verified \
  --dataset-revision FULL_DATASET_COMMIT_SHA \
  --split test \
  --source-url https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified \
  --selection "Every prediction in the published run, selected before AgentShip evaluation." \
  --retrieved-at 2026-10-10 \
  --output external-corpus.json
```

The importer bounds all files, rejects duplicate or unmatched instances, infrastructure
failures or reports without the current explicit infrastructure-failure classification,
unsafe diff paths, mutable evidence-base URLs, and existing output files. It
hashes the exact dataset export, predictions file, candidate patch strings, and outcome
report bytes. It does not run SWE-bench, fetch remote artifacts, or decide whether the
published run is representative. See the official
[evaluation guide](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/evaluation.md)
and [submission layout](https://github.com/SWE-bench/SWE-bench/blob/main/docs/reference/cli.md).

## Required publication method

A publishable corpus must document all of the following:

1. Select tasks before inspecting AgentShip results, using a deterministic rule over an
   immutable dataset revision.
2. Include independently produced candidate patches, not AgentShip-authored ablations or
   gold patches relabeled as agent output.
3. Derive `omissionExpected` from the external evaluator's task-level outcome and retain a
   stable result URL or equivalent public evidence.
4. Include complete and incomplete candidates and report repository/category coverage.
5. Publish the exact corpus bytes and SHA-256 emitted by AgentShip. Do not generalize beyond
   the sampled dataset, candidates, and evaluator.

The repository does not yet contain such a representative candidate set. The schema and
fail-closed provenance validation are infrastructure for collecting it; current synthetic
metrics remain regression baselines.
