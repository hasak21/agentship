<!-- agentship: strict-change-coverage -->

# Enforce strict change coverage

## Objective

Let task authors opt into deterministic warnings when changed files lack explicit requirement attribution.

## Requirements

1. Parse the exact strict-coverage directive and carry task options through `change:src/**`.
2. Exclude the task input itself and retain explicit-only attribution in `change:src/review/requirement-mapper.ts`.
3. Emit warning evidence for strict unattributed changes without blocking or calling them semantically unrelated.
4. Cover directive parsing, exclusions, advisory mode, and strict warnings in `change:tests/**`; require `check:test` and `check:lint`.
5. Exercise deterministic fixture behavior through `change:fixtures/**`.
6. Document the task-owned policy boundary and usage in `change:docs/**` and `change:README.md`.

## Out of scope

- Immutable repository policy.
- Semantic proof that an unattributed file is unrelated.
