# Fix hosted bubblewrap loopback initialization

## Requirements

1. [confirm] Preserve denied network namespaces while allowing bubblewrap to initialize loopback on the live GitHub-hosted kernel in `change:src/review/sandbox.ts` and `change:scripts/install-ci-bubblewrap.sh`.
2. [confirm] Drop every transient namespace-setup capability through a trusted host binary before repository code starts.
3. Prove denied networking and zero effective check capabilities in `change:tests/review.test.ts` and verify the CI provisioner lifecycle in `change:tests/github-action.test.ts`; require `check:test` and `check:lint`.
4. Document the exact transient-capability boundary in `change:docs/ISOLATED_CHECKS.md` and `change:docs/THREAT_MODEL.md`.

## Non-goals

- Granting capabilities to repository code.
- Relaxing default network denial.
- Claiming same-repository PR validation proves fork token and secret behavior.
