# Baseline comparison

AgentShip can compare the current findings with one previous AgentShip JSON report:

```bash
agentship review --baseline path/to/prior-report.json
```

The baseline must use schema version 1 and contain a run ID, repository head, and findings with an ID, kind, and blocker/warning severity. Input is limited to 5 MiB and 10,000 findings. Identity fields are bounded and duplicate ID/kind pairs are rejected.

Comparison uses the exact `(finding ID, finding kind)` pair:

- **new** — present now, absent from the baseline;
- **existing** — present in both reports;
- **resolved** — present in the baseline, absent now.

Severity is retained as evidence but is not part of identity, so a severity change remains the same finding and can be inspected directly. Suppression state is also not part of identity. The report records the baseline path, SHA-256, run ID, and commit.

Baseline comparison is informational. It does not remove findings, suppress them, or affect the current verdict. AgentShip does not yet choose a baseline, retrieve prior CI artifacts, verify provenance, or maintain durable cross-run history automatically.
