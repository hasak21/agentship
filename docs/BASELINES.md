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

Baseline comparison is informational. It does not remove findings, suppress them, or affect the current verdict.

`--history <repository-relative-directory>` records JSON, Markdown, and SARIF for every run and automatically selects the newest compatible JSON report before recording the current result. Compatibility requires identical configuration and task SHA-256 values, review scope, and base reference. The directory is limited to 1,000 entries and every candidate retains the 5 MiB report bound. Malformed history fails closed; newer incompatible reports are skipped. An explicit `--baseline` takes precedence and is labeled as explicit selection in history evidence.

The default `.agentship/history` directory is ignored for local use. The checked-in CI restores the newest report for the same pull-request number from the `agentship-history-v1-pr-` cache namespace with explicit read-only cache access. Its separate `workflow_run` publisher validates the bounded report and workflow/PR/base bindings, canonicalizes it into a fresh directory, and saves a unique cache entry with write-only access. The next review still applies normal configuration/task/scope/base compatibility before selection. A cache miss, eviction, task edit, or incompatible base simply produces `selection: none_found` and cannot affect the current verdict.

The publisher attests the exact canonical JSON before saving it, but cache restoration does not retrieve or verify the attestation bundle. Cache readers therefore still receive restored bytes as untrusted, informational data, and another repository workflow could collide with the namespace if operators permit it. The pull-request workflow cannot save because its job declares `cache-mode: read`; do not weaken that setting or add another untrusted writer. Repository-controlled symbolic links cannot redirect the history directory at read or write time. Only the latest validated report is retained in each cache entry rather than a complete audit archive.
