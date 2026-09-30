# Sign evidence reports

Add optional, independently verifiable report authenticity without allowing an untrusted
report to nominate its own signing authority.

## Requirements

1. [confirm] Sign a canonical statement binding exact AgentShip JSON bytes/hash and trusted public-key fingerprint with Ed25519 in `change:src/review/signature.ts`.
2. [confirm] Require out-of-repository secure private keys, explicit external trusted public keys, bounded strict sidecars, contained atomic output, and fail-closed tamper/key mismatch behavior in `change:src/review/signature.ts`.
3. Expose review signing and standalone verification through `change:src/cli/index.ts`, package it in `change:scripts/verify-cli.mjs`, and prove tamper, wrong-key, repository-key, and permission rejection in `change:tests/signature.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
4. Document statement semantics, key ownership limits, unsigned CI, and unfinished attestation work in `change:README.md`, `change:docs/EVIDENCE_SIGNATURES.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Treating a public key carried with an untrusted report as trusted.
- Sending a signing secret into the pull-request execution workflow.
- Claiming trusted timestamps, revocation, HSM protection, or runner-image attestation.
