# Finding outcomes

AgentShip can record what happened after a finding so calibration is based on retained
events instead of a reconstructed spreadsheet. The four version 1 outcomes are:

- `accepted`: a human agrees that the finding is valid.
- `rejected`: a human classifies the finding as a false positive or not actionable.
- `fixed`: a later compatible AgentShip report no longer contains the exact finding ID
  and kind.
- `overridden`: the source report retains a validated hash-bound override on the finding.

Record an accepted or rejected disposition:

```bash
node dist/agentship.cjs outcome \
  --report .agentship/reviews/review.json \
  --finding-id check-1 \
  --finding-kind required_check_failed \
  --status accepted \
  --actor maintainer@example.com \
  --reason "Reproduced locally."
```

For `fixed`, add `--resolution-report .agentship/reviews/after-fix.json`. The source and
resolution reports must have the same configuration hash, task hash, review scope, and
base reference. It must be newer and describe a changed head or diff, while the exact
target finding must be absent. Other statuses reject a resolution report.

Events are written with exclusive creation under `.agentship/outcomes` by default; use
`--output-dir` to choose another repository-relative directory. Each event binds the
source report bytes by SHA-256 and retains the run, repository, policy, task, finding,
actor, reason, timestamp, and elapsed triage time. Reports are limited to 5 MiB and 10,000
findings, and input/output paths must remain inside the repository.

`accepted` and `rejected` are human dispositions, not independently reproduced facts.
Actor strings are claims and are not authenticated or signed in version 1. A `fixed`
event proves only that a compatible later review did not emit the same identity; it does
not prove semantic correctness. Keep outcome directories in a trusted artifact store if
they are used for organizational metrics, because local records have no provenance
signature yet.

## Calibration metrics

Combine outcomes with a complete review denominator and an independently labeled omission
corpus:

```bash
npm run metrics -- \
  --outcomes .agentship/outcomes \
  --reports .agentship/history \
  --benchmark-fixtures fixtures/intent/executable-patch-corpus.json
```

The result reports finding and blocker precision, independently measured omission recall,
false blocks per 100 reviews, median triage time, override rate, and post-override
outcomes. Outcome events alone cannot measure recall, so the command executes the supplied
corpus and binds its hash and case count. Source and resolution report bytes must occur in
the report set; duplicate lifecycle events are grouped, while conflicting confirmed and
rejected dispositions fail closed. See `CALIBRATION.md` for formulas and limitations.
