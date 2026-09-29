# Calibration metrics

AgentShip combines three explicit evidence sets instead of deriving every metric from a
single convenient sample:

- A review-report directory supplies the complete review denominator.
- A finding-outcome directory supplies human dispositions and resolution evidence.
- An executable or labeled intent corpus supplies omission recall.

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
hash.

## Formulas

- Finding precision = unique confirmed findings / unique confirmed-or-rejected findings.
  `accepted` and evidence-backed `fixed` count as confirmed; override-only findings are
  not truth labels.
- Blocker precision applies the same formula only to blocker findings.
- Omission recall is copied from a freshly executed benchmark corpus and retains its case
  count and hash.
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
