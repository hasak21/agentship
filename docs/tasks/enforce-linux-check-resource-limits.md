# Enforce Linux check resource limits

Bound individual verification processes in the official report workflow without claiming
that resource limits are equivalent to hostile-code isolation.

## Requirements

1. [confirm] Validate CPU, memory, file-size, and open-file resource policy in `change:src/review/config.ts` and `change:src/review/types.ts`.
2. [confirm] Enforce configured limits with a fail-closed Linux backend and retain execution evidence in `change:src/review/runner.ts` and `change:src/review/review.ts`.
3. [confirm] Load a base-owned bounded policy from `change:.agentship.ci.yml` after an explicit backend preflight in `change:.github/workflows/agentship-report.yml`.
4. Prove configuration, invocation, and workflow behavior in `change:tests/config.test.ts`, `change:tests/review.test.ts`, and `change:tests/github-action.test.ts`; require `check:test` and `check:lint`.
5. Document exact guarantees and residual isolation gaps in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming aggregate process-tree accounting, process-count or disk-capacity quotas.
- Denying network or filesystem access.
- Treating `prlimit` as a container, virtual machine, or hostile-code sandbox.
