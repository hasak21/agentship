# Prove the trusted CI policy boundary

Ensure an untrusted pull request cannot weaken the policy, approve protected
changes, or introduce its own override into the official report workflow.

## Requirements

1. Execute a regression where a subject weakens its own configuration while an external trusted policy still blocks the change in `change:tests/policy-boundary.test.ts`.
2. Assert that the official workflow uses base-owned policy and never consumes subject approval or override flags in `change:tests/github-action.test.ts`.
3. Document the effective-policy boundary and complete the milestone in `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`; require `check:test` and `check:lint`.
