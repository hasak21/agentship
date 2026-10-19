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

Events are published atomically without replacement under `.agentship/outcomes` by default; use
`--output-dir` to choose another repository-relative directory. Each event binds the
source report bytes by SHA-256 and retains the run, repository, policy, task, finding,
actor, reason, timestamp, and elapsed triage time. Reports are limited to 5 MiB and 10,000
findings, and input/output paths must remain inside the repository.

Both outcome and missed-finding output reject Git administration paths and linked
directory ancestors. On Linux, traversal is rooted in pinned no-follow directory
descriptors, so a rejected linked ancestor cannot first create directories outside
the repository. Each event is staged privately (mode 0600), fully written and synced,
then published by a same-directory hard link that fails if any destination entry
already exists. The filesystem must support hard links; no overwriting/non-atomic
fallback is used. Normal success/failure removes staging files. This protects API
publication, not later modification by the host owner, multi-event transactions,
crash cleanup or crash durability of directory entries.

`accepted` and `rejected` are human dispositions, not independently reproduced facts.
Actor strings are claims and are not authenticated or signed in version 1. A `fixed`
event proves only that a compatible later review did not emit the same identity; it does
not prove semantic correctness. Keep outcome directories in a trusted artifact store if
they are used for organizational metrics, because local records have no provenance
signature yet.

## Missed-finding labels

An independent audit can label a finding that the bound report did not emit:

```bash
node dist/agentship.cjs missed \
  --report .agentship/reviews/review.json \
  --finding-id audit-authorization-gap \
  --finding-kind missing_security_validation \
  --severity blocker \
  --title "Authorization validation was missed" \
  --actor auditor@example.com \
  --reason "Confirmed by an independent patch audit."
```

The command rejects an identity already present in the report and writes an immutable,
hash-bound label under `.agentship/missed-findings`. This proves only that a human made the
label against those exact report bytes. Actor identity, independence, correctness, and
sampling representativeness are not authenticated by schema version 1.

After inspecting the whole report for omissions and recording any labels, mark the audit
complete. This also works when the audit found no missed findings:

```bash
node dist/agentship.cjs missed-audit \
  --report .agentship/reviews/review.json \
  --actor auditor@example.com \
  --reason "Checked every task requirement against the patch and report."
```

The audit binds the exact report bytes and a digest of the current labels for that report.
`--labels-dir` and `--output-dir` can select repository-relative directories. Adding,
removing, or changing a label after completion invalidates the audit; complete a new
audit in a fresh collection rather than counting the old one.

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

To aggregate human missed-finding labels against the same review corpus, run:

```bash
node dist/agentship.cjs outcome-metrics \
  --outcomes .agentship/outcomes \
  --reports .agentship/history \
  --missed-findings .agentship/missed-findings \
  --missed-audits .agentship/missed-audits
```

This separate report includes disposition precision and coverage, rejected blocker
share, median/p90 triage duration, false-blocked reviews per 100 reports, and recall
from accepted/fixed findings in audited reports and supplied missed labels. It includes
audited-report count and coverage of the supplied report corpus. Every label and audit
is checked against exact report bytes, and each audit must still match its label set.
An empty audit set yields `null` recall. The result represents the audited sample;
population recall requires a representative review and audit set. Duplicate dispositions,
audits, and missed labels for the same source-report finding fail closed. Audit actor
strings remain unauthenticated claims.
