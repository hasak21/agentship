# Add owned warning suppressions

## Objective

Allow teams to acknowledge narrowly identified warning findings temporarily without hiding evidence or weakening blocker decisions.

## Requirements

1. [confirm] Add exact finding-ID/kind suppression application and verdict handling under `change:src/review/**`, and expose active/suppressed counts through `change:src/cli/**`.
2. Validate stable IDs, warning-only kinds, owner, bounded reason, calendar expiry, and duplicate rejection under `change:src/review/config.ts`.
3. Preserve suppression evidence in JSON, Markdown, and SARIF and cover active, expired, blocker, invalid, and duplicate behavior under `change:tests/**`; require `check:test`, `check:lint`, `check:build`, and `check:cli-package`.
4. Document trusted-base versus local-policy behavior throughout `change:README.md` and `change:docs/**`.

## Out of scope

- Suppressing blocker findings.
- Authenticated or signed overrides.
- Baseline comparison and cross-run history.
