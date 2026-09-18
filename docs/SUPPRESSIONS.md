# Finding suppressions

Suppressions acknowledge a specific, temporary warning without erasing it. They are repository policy, not comments embedded in untrusted task text.

```yaml
policy:
  suppressions:
    - id: legacy-doc-gap
      findingId: requirement-R3
      kind: inferred_requirement_role_missing
      owner: docs-team
      reason: Migration guide is tracked in issue 123.
      expiresAt: 2026-12-31
```

All fields are required. `findingId` and `kind` must both match, the expiry date is evaluated in UTC and remains active through that date, and duplicate IDs or targets are rejected. Only warning kinds are accepted:

- `optional_check_failed`
- `explicit_requirement_path_unchanged`
- `explicit_requirement_evidence_unsatisfied`
- `inferred_requirement_role_missing`
- `unattributed_changes`

An active suppression remains attached to the original finding in JSON, appears with its owner, reason, and expiry in Markdown, and is emitted as an accepted external suppression in SARIF. It removes that warning from verdict calculation but does not turn the finding into passing evidence. Expired suppressions have no effect.

The GitHub pull-request workflow loads `.agentship.yml` from the trusted base revision. A pull request therefore cannot add a suppression that affects its own run. Local working-tree review trusts the local policy and does not provide immutable or authenticated approval.
