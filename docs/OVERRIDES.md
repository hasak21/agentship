# Hash-bound overrides

Overrides record an exceptional human decision without deleting the finding that
caused it. They are deliberately separate from repository warning suppressions.

## Workflow

1. Run AgentShip without an override and retain the JSON report.
2. Compute the report's SHA-256.
3. Create a JSON override record with `schemaVersion: 1`, a stable `id`, `actor`,
   `reason`, `expiresAt`, the source report `path` and `sha256`, and exact
   `(finding id, finding kind)` targets.
4. Rerun the identical review with `--override path/to/override.json`.

The source report must describe the same Git head, diff SHA-256, configuration
SHA-256, and task SHA-256 as the new run. Every target must remain present in the
current findings. A changed patch, task, policy, report byte, finding identity, or
expired record is rejected rather than silently ignored.

## Overrideable findings

Version 1 permits explicit overrides for required or optional check failures and
intent-coverage findings. It does not permit overrides for repository mutation,
review-budget excess, missing requirement confirmation, or missing protected-path
approval. Those findings indicate invalid evidence or have a dedicated decision
mechanism and must be resolved directly.

## Trust boundary

The override record and source report are bounded and parsed only as data. JSON,
Markdown, and SARIF retain the finding plus override ID, claimed actor, reason,
expiry, record hash, and source report hash. The actor string is not authenticated
and the record is not signed. Local use therefore trusts the operator and checkout.
CI enforcement must load override records from a trusted revision; accepting a
record introduced by the same untrusted change would allow self-approval.
