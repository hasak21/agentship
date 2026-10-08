# Isolate official CI checks

Move the secretless pull-request report workflow onto AgentShip's disposable bubblewrap
worker without trusting a floating hosted-runner package.

## Requirements

1. [confirm] Provision a version- and SHA-256-pinned Ubuntu Noble bubblewrap package before pull-request code executes in `change:scripts/install-ci-bubblewrap.sh` and invoke it from `change:.github/workflows/agentship-report.yml`.
2. [confirm] Fail closed on the wrong platform, package digest, version, executable mode, or namespace capability in `change:scripts/install-ci-bubblewrap.sh`.
3. [confirm] Run every trusted CI-policy check with disposable-copy bubblewrap isolation, deny network by default, and retain only the explicit build exception in `change:.agentship.ci.yml`.
4. Prove the workflow remains read-only, immutable-action-pinned, base-policy-controlled, and now requires the pinned sandbox in `change:tests/github-action.test.ts`, and verify the sandbox network namespace without a host listener in `change:tests/review.test.ts`; require `check:test` and `check:lint`.
5. Document the new official worker boundary and its residual kernel, network-exception, dependency-install, disk, cgroup, and live-fork-validation risks in `change:docs/CI_REPORT_MODE.md`, `change:docs/ISOLATED_CHECKS.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming that namespaces are a virtual machine or protect against host-kernel exploits.
- Running dependency installation inside the sandbox.
- Enabling secrets, write permissions, self-hosted runners, or merge gating.
