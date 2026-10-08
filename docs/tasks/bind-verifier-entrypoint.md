# Bind verifier entrypoint

Make an evidence report identify the exact AgentShip entrypoint bytes that produced it,
with the standalone bundle serving as the complete verifier artifact in official CI.

## Requirements

1. [confirm] Canonicalize, bound, stability-check, and SHA-256 hash the actual verifier entrypoint in `change:src/review/provenance.ts`, with direct regression coverage in `change:tests/provenance.test.ts`.
2. [confirm] Record verifier path, size, and digest in the report schema and Markdown through `change:src/review/types.ts`, `change:src/review/review.ts`, and actual-launch wiring in `change:src/cli/index.ts`, with rendering coverage in `change:tests/review.test.ts`.
3. Prove the isolated standalone CLI reports the exact copied bundle digest in `change:scripts/verify-cli.mjs`; require `check:cli-package` and `check:test`.
4. Require bounded verifier provenance before the privileged publisher accepts CI evidence and include its digest in the neutral summary through `change:scripts/build-check-run.mjs` and `change:tests/check-publisher.test.ts`.
5. Document the difference between a complete standalone-bundle digest and a source-entry digest, plus unfinished runner identity and authenticated signing, in `change:README.md`, `change:docs/TRUST_MODEL.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming that a source entrypoint hash covers imported source files or dependencies.
- Authenticating the digest without a separately trusted signature/public key.
- Attesting the host kernel, runner image, Node binary, or dependency installation.
