# Detached evidence signatures

AgentShip can sign the exact JSON report bytes with Ed25519 after review artifacts have
been written. Pass `--signing-key <path>` to `agentship review`; the default detached
sidecar replaces `.json` with `.sig.json`. `--signature-output` may select another path
whose parent already exists inside the reviewed repository.

## Signed statement

The canonical compact-JSON statement contains only:

- schema version and `agentship.evidence-signature` type;
- fixed `Ed25519` algorithm;
- exact report byte length and SHA-256;
- SHA-256 of the signer's public key in SPKI DER form.

The sidecar adds the canonical base64 Ed25519 signature. It deliberately contains no
public key, signer name, mutable timestamp, verdict override, or trust claim. Verification
rebuilds the statement from the report and an explicitly supplied trusted public key,
checks every bound value, requires a 64-byte signature, and then verifies Ed25519.

## Key boundary

The private key must resolve outside the reviewed repository. On POSIX its mode must not
grant group or other access. Only unencrypted PKCS#8 Ed25519 private keys are supported in
this local first version; use a dedicated short-lived development key, not an unrelated
production identity. Verification likewise rejects a public key inside its trusted
working root so an untrusted checkout cannot nominate its own authority.

```bash
agentship verify-signature \
  --report evidence.json \
  --signature evidence.sig.json \
  --public-key /trusted/keys/team.pem
```

A valid signature means the report bytes have not changed since a holder of the matching
private key signed them. Identity comes from the operator's independent mapping of the
printed public-key SHA-256 to an owner.

## CI boundary

The checked-in pull-request workflow remains secretless and does not sign. Never place a
private signing key in a job that executes pull-request code, even when bubblewrap is
enabled. A future publisher may sign only after it validates the bounded artifact in a
non-executing privileged job, and should use an HSM/KMS or workload-identity attestation
rather than a long-lived file key.

Current sidecars do not provide trusted time, key revocation, transparency logging,
binary/runner-image attestation, or signatures for automatic history/cache copies.
