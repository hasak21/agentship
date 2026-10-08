# Record runner provenance

Bind reports to bounded host/runtime evidence so consumers can distinguish verifier bytes
from the Node and runner image that executed them without overstating attestation.

## Requirements

1. [confirm] Collect bounded platform, architecture, kernel, optional OS-release hash/identity, exact Node executable bytes/hash, and optional GitHub runner/image metadata in `change:src/review/runner-provenance.ts`, with deterministic coverage in `change:tests/runner-provenance.test.ts`.
2. [confirm] Record and render runner provenance through `change:src/review/types.ts`, `change:src/review/review.ts`, and actual CLI wiring in `change:src/cli/index.ts`, with Markdown coverage in `change:tests/review.test.ts`.
3. Verify the standalone CLI reports the launching Node runtime in `change:scripts/verify-cli.mjs`; require `check:cli-package` and `check:test`.
4. Require bounded runner/runtime provenance before privileged CI publication and summarize the image/runtime identity through `change:scripts/build-check-run.mjs` and `change:tests/check-publisher.test.ts`.
5. Document recorded identity versus authenticated attestation and remaining host/build trust in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming that environment variables or local OS files cryptographically attest a host.
- Hashing the kernel, every shared library, package, or dependency.
- Replacing a signed runner-image or workload-identity attestation.
