# Reproducible agent leaderboard

`agentship leaderboard --submissions <directory>` compiles comparable AgentShip reports
into deterministic JSON. Each top-level `*.submission.json` file declares one agent,
one suite ID and SHA-256, and the exact report and task SHA-256 for every task.

```json
{
  "schemaVersion": 1,
  "type": "agentship.agent-evaluation",
  "submissionId": "codex-config-a",
  "agent": { "name": "Codex", "model": "pinned-model-id" },
  "suite": { "id": "payments-v1", "sha256": "...64 hex..." },
  "tasks": [{
    "id": "refund-race",
    "taskSha256": "...64 hex...",
    "report": "reports/refund-race.json",
    "reportSha256": "...64 hex..."
  }]
}
```

The compiler bounds inputs, rejects paths outside the submission directory, verifies
every report digest and task binding, and requires identical suite provenance and task
sets across candidates. Ranking uses PASS rate, then fewer active blockers, then more
causal reproductions, then stable submission ID order. Output contains no current time,
so identical evidence produces identical results.

For each task, reports must also declare the same `configuration.sha256` and
`repository.reviewScope`. Base comparisons require the same non-empty declared
`repository.base` and full resolved `repository.baseCommit`; non-base scopes must not declare either. Missing/invalid review
context is rejected, not treated as a wildcard. Different tasks may use different
policies or scopes, provided all candidates agree for that task. Output records
these bindings in `suite.reviewContexts`, sorted by task ID independently of input
task order. The resolved commit must also match any causal check's base identity.
Legacy base-scope reports without a resolved identity are rejected rather than
treated as equivalent to a new report. These are recorded identity bindings, not
authentication that the declared policy or runner actually executed.

Limits are 100 submissions, 1,000 tasks per submission, 1 MiB per manifest,
5 MiB per report, and 64 MiB of total input bytes per compilation (including
manifests and every report read; repeated references are charged again). Evidence
is read sequentially through a nonblocking regular-file reader with an enforced
read-time byte bound. Reports are reduced to scalar metrics rather than retained
as an all-reports object graph. Invalid UTF-8 is rejected before JSON parsing;
hashes continue to bind the exact original bytes. Exceeding the remaining total
budget fails the compilation, not a partial ranking. These are input bounds,
not a process memory quota or filesystem deadline.

Ranking-relevant fields are type/cardinality checked, with unique finding identities
and check names. Verdicts must match the active findings: any active blocker means
BLOCK, otherwise any active finding means WARN, otherwise PASS. Suppression/override
markers must carry structured metadata, not arbitrary truthy values. Causal flags
must be booleans and agree with a passing head check and the base-failure classifier
(including resource/accounting/cleanup failures and ambiguous shell exits). Known
non-executed backends cannot supply successful/nonzero exit evidence. Non-regular
`*.submission.json` entries fail compilation rather than silently dropping candidates.
This checks internal consistency, not the full report schema, policy authorization,
historical approval validity, assertion-level failure identity, or actual execution.

This authenticates neither report producers nor runners. Public results should distribute
the suite, manifests, reports, and their independent signatures or GitHub attestations.
A synthetic or selectively reported suite is not representative, regardless of hashing.
