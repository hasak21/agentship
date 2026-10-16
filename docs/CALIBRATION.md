# Calibration metrics

AgentShip combines three explicit evidence sets instead of deriving every metric from a
single convenient sample:

- A review-report directory supplies the complete review denominator.
- A finding-outcome directory supplies human dispositions and resolution evidence.
- An executable or labeled intent corpus supplies omission-label recall; an externally
  evaluated corpus supplies a separately identified task-resolution proxy metric.

Run calibration with:

```bash
npm run metrics -- \
  --outcomes .agentship/outcomes \
  --reports .agentship/history \
  --benchmark-fixtures fixtures/intent/executable-patch-corpus.json \
  > calibration.json
```

All paths are repository-relative. Directories are flat, limited to 1,000 entries, and
only `.json` files are included. Outcome files are limited to 128 KiB and reports to 5
MiB. Every outcome source report—and every fixed outcome resolution report—must be in the
report set with matching bytes and run ID. Fixed events are rechecked for compatible
policy/task/scope/base, a newer changed state, and absence of the finding. Override events
are rechecked against retained source-report override evidence. The output binds sorted
input paths and hashes into aggregate SHA-256 values and includes the benchmark corpus
hash. Externally evaluated corpora also retain their immutable dataset, predictions, and
selection provenance in the calibration report.

## Formulas

- Finding precision = unique confirmed findings / unique confirmed-or-rejected findings.
  `accepted` and evidence-backed `fixed` count as confirmed; override-only findings are
  not truth labels.
- Blocker precision applies the same formula only to blocker findings.
- Omission-label recall is copied from a freshly executed declared/file-oracle corpus and
  retains its case count, label semantics, and hash. For external task outcomes,
  `recall.omissions` is `null` and the value is in `recall.taskResolutionProxy` instead.
- False blocks per 100 reviews = unique rejected blocker findings / all supplied review
  reports × 100.
- Median triage time uses the earliest recorded outcome duration for each unique source
  report + finding identity. Multiple lifecycle events therefore do not inflate the
  sample.
- Override rate = unique findings with an override event / all tracked unique findings.
  The report also counts later accepted, rejected, and fixed events after the first
  override.

Precision is `null` when there are no adjudicated samples in its denominator. Conflicting
confirmed and rejected outcomes fail the run instead of selecting the newest opinion.
Report run IDs, report bytes, outcome IDs, and finding identities must be unique where
their semantics require it.

These are calibration measurements, not universal product claims. Accepted and rejected
statuses remain unauthenticated human assertions; local files are unsigned; and recall is
only representative of the supplied corpus. Store all three evidence sets in trusted,
append-only storage before using the output for organizational or public comparisons.

The first pinned external pilot measures 20 independent candidates across 12 repositories.
Against published task-resolution proxy labels, the current detector misses all five
unresolved candidates and flags one of 15 resolved candidates. See `docs/EXTERNAL_CORPUS.md`
for the outcome-blind selection, reproduction commands, hashes, and limits. These labels
do not distinguish requirement omissions from other implementation failures, so the
result is a diagnostic baseline rather than semantic omission recall. Preserve this
baseline and use a separate holdout before claiming improvements from tuning.

A subsequent clause-aware repair removes the development-set flag without improving its
zero recall. A preselected, identity-disjoint 16-case holdout yields one detected and two
missed unresolved candidates, with zero flags among 13 resolved candidates. Source hashes
and all individual results are retained in
`docs/benchmarks/swebench-clause-aware-20261016.json`. When the detector emits no findings,
benchmark `precision` and explicit-mapping `missingPrecision` are now `null`, since their
denominator is empty. Consumers must accept this instead of interpreting no evidence as
perfect precision. No representative or semantic-omission accuracy claim follows.

## Machine-readable label semantics

Every benchmark report derives `corpus.labelSemantics` from its corpus kind and, if
supplied, a validated hash-bound adjudication packet, not an arbitrary input declaration:

| Corpus kind | Label semantics | Calibration recall field |
| --- | --- | --- |
| `labeled_scenario` | `declared_omission` | `recall.omissions` |
| `executable_patch` | `file_oracle_omission` | `recall.omissions` |
| `external_evaluation` | `task_resolution_proxy` | `recall.taskResolutionProxy` |
| `external_evaluation` + validated adjudications | `reviewer_asserted_omission` | `recall.omissions` |

Reviewer assertions are not authenticated identities or executed proof. Packet hashes
and decided/abstained/unreviewed coverage are retained in `inputs.benchmark.adjudication`;
`recall.cases` counts only explicit decisions, not the full input population. Evidence
locators are required but not independently verified. See the
[review workflow](EXTERNAL_CORPUS.md#blinded-semantic-review).

Calibration retains the same semantics in `inputs.benchmark.labelSemantics` and
`recall.labelSemantics`. For external evaluation, output is shaped like:

```json
{
  "recall": {
    "omissions": null,
    "taskResolutionProxy": 0.3333333333333333,
    "labelSemantics": "task_resolution_proxy",
    "cases": 16
  }
}
```

Existing external corpus bytes without a semantics field remain valid and retain their
original SHA-256; their semantics are derived when evaluated. An external corpus that
explicitly declares a different label semantics is rejected, so a task outcome cannot
be relabeled as an independently adjudicated omission through this schema. Declared
labels and file-content oracles also do not establish representative semantic accuracy.

Consumers must accept nullable benchmark rates: precision is `null` without predicted
positives, recall is `null` without positive truth labels, and false-positive rate is
`null` without negative truth labels. Historical stored summaries are not rewritten;
read their source hashes and measurement date when comparing output versions.
