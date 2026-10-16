# Blinded omission adjudication tooling

## Requirements

1. Prepare unreviewed external-case packets without external outcomes, model identities, or detector conclusions; validate patch digests and never overwrite existing output. `change:src/review/omission-adjudication.ts` `change:src/cli/index.ts`
2. Bind labels to exact corpus bytes, task, patch, paths, repository and base revision; reject duplicate/missing cases, unsupported decisions and unsupported conclusions. `change:src/review/omission-adjudication.ts`
3. Include only explicit omission/complete decisions in benchmark metrics, retain coverage and packet hashes, and classify these as reviewer assertions rather than authenticated truth. `change:src/review/intent-benchmark.ts`
4. Propagate reviewer-label provenance into calibration without mixing task-resolution proxies. `change:src/review/calibration.ts`
5. Exercise adversarial bindings and standalone CLI initialization, overwrite rejection, incomplete labels, benchmarking and calibration. `change:tests/omission-adjudication.test.ts` `change:scripts/verify-cli.mjs`
6. Document the workflow, limitations and remaining independent human review work. `change:docs/EXTERNAL_CORPUS.md` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
