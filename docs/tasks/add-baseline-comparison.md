# Add baseline comparison

## Objective

Show which findings are new, existing, or resolved relative to a bounded prior AgentShip report without weakening current evidence or verdicts.

## Requirements

1. [confirm] Load, validate, hash, and compare an optional baseline under `change:src/review/**`, and expose `--baseline` plus comparison counts through `change:src/cli/**`.
2. Reject malformed metadata, invalid severities, duplicates, oversized files, and excessive finding counts without executing baseline content.
3. Cover classification and invalid input under `change:tests/**`, and verify the bundled help contract through `change:scripts/verify-cli.mjs`; require `check:test`, `check:lint`, `check:build`, and `check:cli-package`.
4. Document identity semantics, verdict independence, and remaining provenance/history gaps throughout `change:README.md` and `change:docs/**`.

## Out of scope

- Automatically selecting or downloading a baseline.
- Allowing a baseline to change verdicts or suppress findings.
- Durable cross-run storage or cryptographic provenance.
