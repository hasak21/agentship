# Emit SARIF and a CI job summary

## Objective

Add portable machine-readable findings and make the existing report visible in the GitHub Actions run without expanding workflow permissions.

## Requirements

1. [confirm] Emit SARIF with safe repository-relative locations through `change:src/review/review.ts` and expose its path through `change:src/cli/index.ts`.
2. Publish the fixed Markdown report to the job summary and upload every evidence format through `change:.github/workflows/agentship-report.yml`.
3. Cover SARIF conversion and workflow output invariants under `change:tests/**`; require `check:test`, `check:lint`, and `check:cli-package`.
4. Document the outputs and their remaining trust boundary throughout `change:docs/**` and `change:README.md`.

## Out of scope

- Check Run or code-scanning publication.
- Repository write permissions, comments, or merge gating.
- Claiming live fork-pull-request validation before it occurs.
