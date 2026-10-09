# Fix hosted bubblewrap loopback initialization

## Requirements

1. [confirm] Preserve denied network namespaces on the live GitHub-hosted kernel in `change:src/review/sandbox.ts`, `change:scripts/install-ci-bubblewrap.sh`, and `change:.github/workflows/agentship-report.yml`.
2. [confirm] Drop every transient namespace-setup capability through a trusted host binary before repository code starts.
3. Prove denied networking and zero effective check capabilities in `change:tests/review.test.ts` and verify the CI provisioner lifecycle in `change:tests/github-action.test.ts`; require `check:test` and `check:lint`.
4. Document the exact transient-capability boundary in `change:docs/ISOLATED_CHECKS.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/CI_REPORT_MODE.md`.
5. Bind the subject checkout and trusted publisher to the exact pull-request head in `change:.github/workflows/agentship-report.yml` and `change:scripts/build-check-run.mjs`; verify it in `change:tests/check-publisher.test.ts` and `change:tests/github-action.test.ts`.

## Non-goals

- Granting capabilities to repository code.
- Relaxing default network denial.
- Claiming same-repository PR validation proves fork token and secret behavior.
