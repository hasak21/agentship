# Bound aggregate check wall-clock time

Prevent a long sequence of individually bounded checks from consuming unbounded review
time by enforcing one repository-owned cumulative deadline.

## Requirements

1. [confirm] Add a bounded `limits.maxCheckSeconds` policy in `change:src/review/config.ts` and `change:src/review/types.ts`, rejecting unknown review limits.
2. [confirm] Clamp check preparation/execution to the remaining cumulative deadline, stop starting applicable checks after exhaustion, and retain timeout/budget evidence through `change:src/review/runner.ts` and `change:src/review/review.ts`.
3. Prove validation, active-check termination, later-check skipping, blocker creation, and report evidence in `change:tests/config.test.ts` and `change:tests/review.test.ts`; require `check:test` and `check:lint`.
4. Configure the aggregate budget in `change:.agentship.yml`, `change:.agentship.bubblewrap.yml`, and `change:.agentship.ci.yml`, then document its exact boundary in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming aggregate CPU, memory, process-count, or disk-capacity enforcement.
- Replacing the outer workflow/job timeout or kernel/cgroup controls.
- Bounding non-check report parsing, signing, or artifact publication time.
