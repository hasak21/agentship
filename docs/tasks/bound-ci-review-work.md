# Bound CI review work

## Objective

Avoid unnecessary or oversized CI command execution while keeping every selection and budget decision visible in review evidence.

## Requirements

1. [confirm] Add deterministic changed-path check selection, explicit skipped evidence, and pre-execution review budget blockers under `change:src/review/**` and expose skipped counts through `change:src/cli/**`.
2. Validate and dogfood exact/trailing-directory selectors plus positive changed-file/diff-byte limits through `change:.agentship.yml`.
3. Cover valid, invalid, selected, skipped, explicitly required, and exceeded behavior under `change:tests/**`; require `check:test`, `check:lint`, `check:build`, and `check:cli-package`.
4. Document delivered bounds and remaining resource-isolation gaps throughout `change:README.md` and `change:docs/**`.

## Out of scope

- CPU, memory, disk, process-count, or network quotas.
- Self-hosted or privileged hostile-code execution.
- Treating a skipped check as passing evidence.
