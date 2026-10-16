# External intent corpus contract

## Blinded semantic review

Generate a new packet from an imported external corpus (parent directory must exist):

```sh
npm run review -- adjudication-init --fixtures <corpus.json> --output <new-review.json>
```

The output omits external outcome/model/detector fields and starts entirely
`unreviewed`. A reviewer supplies `reviewer`, changes decisions to `omission`,
`complete`, or `abstain`, and provides a rationale. Decided labels require at least
one evidence locator (for example a patch hunk, base-revision source path, or retained
test transcript). Do not modify bound tasks, patches, paths, hashes or repository
references, or delete cases. Abstention requires a rationale but not an evidence
locator. A packet without any decided labels is rejected.

```sh
npm run review -- benchmark --fixtures <corpus.json> --adjudications <review.json>
npm run review -- metrics --outcomes <dir> --reports <dir> --benchmark-fixtures <corpus.json> --adjudications <review.json>
```

Outputs use `reviewer_asserted_omission`, never authenticated ground truth.
`corpus.cases` includes all inputs; `metrics.cases` includes only decided cases;
`corpus.adjudication` retains packet SHA-256, path, reviewer and total/decided/
abstained/unreviewed counts. Calibration retains this in `inputs.benchmark` and
populates omission recall rather than task-resolution proxy recall. Raw packets can
be kept under ignored `.agentship/adjudications/`. No independent human labels have
yet been collected; this tooling alone does not complete semantic evaluation.

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

External benchmark output always sets `corpus.labelSemantics: "task_resolution_proxy"`.
`metrics.recall` is agreement with unresolved-task proxy labels, not semantic omission
recall. Calibration therefore places that value in `recall.taskResolutionProxy`, leaves
`recall.omissions` null, and retains the label semantics alongside both inputs and recall.
Explicit attempts to declare a different semantics on an external corpus fail closed.
See `docs/CALIBRATION.md` for the other label classes and nullable-rate rules.

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

The repository does not yet contain a representative candidate set. A reproducible
20-candidate external pilot is now measured below; its outcome labels are task-resolution
proxies rather than independently adjudicated requirement-omission labels. Current
synthetic and external-pilot metrics remain engineering baselines.

## First public-artifact pilot (2026-10-16)

The official experiments index at commit
`40f164d5b8f1d249bf95a6df8b74b577fd8e519d` identifies submission
`20260901_mini-v2.4.2_gemini-3-5-flash`. Its public
[artifact repository](https://github.com/john-b-yang/20260901_mini-v2.4.2_gemini-3-5-flash/tree/2f6637a2557da1f7b5f2b583ab7090a077bbeed2)
provides independently generated predictions and per-instance reports. The dataset is
pinned to `78f471bf655a3137b2e8a75af1501690ec009ec3`.

Selection was fixed before reading outcomes or running AgentShip: join dataset and
prediction instance identities, group by repository, sort repositories and instance IDs
lexicographically, and take at most two instances per repository. This yielded 20
candidates across 12 repositories. No cases were removed or rebalanced after evaluation.
The published reports classify 15 as resolved and five as unresolved, all with
`infra_failure: false`.

The unchanged detector from AgentShip commit `26dd0d8` produced zero detected unresolved
candidates, five missed unresolved candidates, one flag on a resolved candidate, and 14
unflagged resolved candidates. Against these outcome-proxy labels, precision and recall
are both zero and the false-positive rate is 1/15. The resulting 70% accuracy primarily
reflects the complete-change majority and must not be used as an effectiveness claim.
The resolved `scikit-learn__scikit-learn-10297` case shows a concrete role-inference
failure: implementation instructions followed by a description of existing documentation
are interpreted as a documentation-change request.

The hash-bound summary, all selected identities, patch/report hashes, input revisions,
and per-instance results are retained in
`docs/benchmarks/swebench-stratified-20261016.json`. The corpus SHA-256 is
`b75beeb1a78941996401cdbb668260ba0adf6dc3a357cc985d4479dd63698a12`.
Candidate patches and issue text remain downloaded evidence rather than vendored source.

Reproduce collection with Python 3, pyarrow, curl, and the existing Node dependencies:

```bash
python3 scripts/collect-swebench-sample.py \
  --output .agentship/external/swebench-20260901-stratified-v1

npm run review -- import-swebench \
  --dataset .agentship/external/swebench-20260901-stratified-v1/dataset.jsonl \
  --predictions .agentship/external/swebench-20260901-stratified-v1/all_preds.jsonl \
  --reports .agentship/external/swebench-20260901-stratified-v1/logs \
  --candidate-run 20260901_mini-v2.4.2_gemini-3-5-flash \
  --evidence-base-url https://github.com/john-b-yang/20260901_mini-v2.4.2_gemini-3-5-flash/blob/2f6637a2557da1f7b5f2b583ab7090a077bbeed2/ \
  --dataset-name SWE-bench/SWE-bench_Verified \
  --dataset-revision 78f471bf655a3137b2e8a75af1501690ec009ec3 \
  --split test \
  --source-url https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified \
  --selection 'Join pinned task and prediction identities, group by repo, then take the first two instance IDs per repo lexicographically before inspecting outcomes or AgentShip results.' \
  --retrieved-at 2026-10-16 \
  --output .agentship/external/swebench-20260901-stratified-v1/corpus.json

npm run review -- benchmark \
  --fixtures .agentship/external/swebench-20260901-stratified-v1/corpus.json
```

Collection refuses an existing output directory. A failed partial collection is retained
for inspection; use a new directory to retry. It checks HTTPS downloads, transfer time and
size bounds, records source-byte hashes, and writes the selected identities before
retrieving outcomes. It never imports or executes candidate/task code. The dataset export
contains only the four fields needed by the importer; the manifest also retains the hash
of the complete upstream Parquet and predictions files before projection/subsetting.

This is one submission, a small identity-sorted sample, and one language ecosystem.
Outcomes were read from published reports, not independently rerun or regraded here.
An unresolved task can reflect an implementation bug rather than a missing requirement;
a resolved task can still omit behavior outside the evaluator's tests. Future work must
separate these labels, adjudicate semantic omissions, broaden candidate/task coverage, and
reserve a separate holdout before tuning against this pilot.

## Clause-aware development retest and disjoint holdout

After preserving the original pilot summary, role inference was changed to keep action
verbs and inferred file roles within the same sentence, semicolon-delimited clause, or
spaced-dash clause. The noun `document` is no longer by itself a documentation command.
Targeted regressions include both descriptive mentions and real test/documentation
instructions, and the existing 8-case/12-case synthetic baselines remain unchanged.

On the 20 development cases the resolved-candidate flag disappears, while all five
unresolved candidates remain undetected. With no predicted omissions, precision is
undefined and now emits JSON `null` rather than the former vacuous `1`.

Before inspecting additional outcomes, a disjoint rule was fixed: within each repository's
same sorted candidate list, skip the first two pilot instances and select zero-based
positions two and three. Run the collector with `--partition holdout` and a new output
directory, then import using the selection string recorded in that directory's manifest.
Every selected identity was checked against the pilot; there is no overlap. This yielded
16 candidates across eight repositories, with 13 externally resolved and three unresolved.
The frozen clause-aware detector flagged one unresolved candidate, missed two, and did
not flag any resolved candidate: outcome-proxy recall 1/3 and zero observed false positives.
The single flagged candidate is `pytest-dev__pytest-10356`.

`docs/benchmarks/swebench-clause-aware-20261016.json` retains both partitions, original
corpus and artifact hashes, every result, and SHA-256 values for the exact mapper and
metric source files fixed before the holdout measurement. The holdout corpus SHA-256 is
`e3a1569c067bb96735309c61b3859e8c568ce23bf22ee34dad95bd629b8a41f7`.
The original `swebench-stratified-20261016.json` baseline has not been replaced.

These results are small-sample diagnostics, not evidence of general semantic detection
or a statistically established improvement. The holdout shares the same submission,
dataset and Python ecosystem; published resolution remains a proxy label. Do not tune
against these now-observed holdout cases and continue calling them unseen evaluation data.
