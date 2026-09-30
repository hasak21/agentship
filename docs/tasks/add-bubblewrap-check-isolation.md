# Add bubblewrap check isolation

Provide a fail-closed Linux worker that materially separates untrusted check execution
from the host without overstating it as a complete maintainer-mode sandbox.

## Requirements

1. [confirm] Validate an explicit bubblewrap isolation policy and retain its effective backend, workspace, filesystem, and network mode in `change:src/review/types.ts`, `change:src/review/config.ts`, and `change:src/review/review.ts`.
2. [confirm] Copy the subject into a bounded disposable workspace, expose only a minimal read-only runtime, strip credential-shaped environment values, default to network denial, compose with resource limits, and clean up in `change:src/review/sandbox.ts` and `change:src/review/runner.ts`.
3. Prove fail-closed configuration, invocation composition, hidden host files, discarded mutations, denied host-loopback access, and the official CI non-claim in `change:tests/config.test.ts`, `change:tests/review.test.ts`, and `change:tests/github-action.test.ts`; require `check:test` and `check:lint`.
4. Dogfood the backend with `change:.agentship.bubblewrap.yml` and document exact guarantees, opt-in configuration, GitHub provisioning status, and residual kernel/resource risks in `change:README.md`, `change:docs/ISOLATED_CHECKS.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming virtual-machine or kernel-exploit isolation.
- Enabling a floating, unpinned bubblewrap installation in the official workflow.
- Claiming cgroup-wide memory, process-count, or disk-capacity quotas.
