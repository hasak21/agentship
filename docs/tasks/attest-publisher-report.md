# Attest the publisher-validated report

Authenticate the privileged publisher workflow and exact canonical report bytes without
granting identity or write permissions to pull-request execution.

## Requirements

1. [confirm] After bounded validation, attest only the fresh canonical JSON with the current full-SHA-pinned official GitHub attestation action in `change:.github/workflows/agentship-publish-check.yml`.
2. [confirm] Keep attestation permissions in the non-executing `workflow_run` publisher, upload the canonical report and Sigstore bundle, and expose a validated attestation URL in the neutral Check Run.
3. Prove permissions, immutable action pins, validation-before-attestation ordering, exact subject selection, bundle upload, and continued separation from the subject workflow in `change:tests/check-publisher.test.ts` and `change:tests/github-action.test.ts`; require `check:test` and `check:lint`.
4. Document online/offline verification, feature availability, and the distinction between publisher provenance and original runner truth in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/EVIDENCE_SIGNATURES.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, `change:docs/BASELINES.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Attesting that environment metadata inside the report is truthful.
- Granting OIDC, attestation, secret, or write access to pull-request code.
- Turning the neutral report into a merge gate.
