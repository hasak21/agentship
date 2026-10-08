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

This authenticates neither report producers nor runners. Public results should distribute
the suite, manifests, reports, and their independent signatures or GitHub attestations.
A synthetic or selectively reported suite is not representative, regardless of hashing.
