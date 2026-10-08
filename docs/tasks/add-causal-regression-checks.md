# Add causal regression checks

## Requirements

1. Add an opt-in fail-on-base check policy with explicit test overlays in `change:src/review/types.ts` and `change:src/review/config.ts`.
2. Build the merge-base experiment from a temporary detached worktree and run both revisions through bounded bubblewrap execution in `change:src/review/git.ts`, `change:src/review/sandbox.ts`, `change:src/review/runner.ts`, and `change:src/review/review.ts`.
3. Retain base commit, overlay, status, exit, output, timing, and execution evidence; emit a non-overridable blocker unless head passes and base fails normally.
4. Cover configuration, successful reproduction, and non-reproduction findings in `change:tests/config.test.ts` and `change:tests/review.test.ts`; require `check:test` and `check:lint`.
5. Document operation and residual semantic/dependency limitations in `change:README.md`, `change:docs/CAUSAL_CHECKS.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Inferring which files are tests.
- Claiming that a causal test is a correct or complete specification.
- Supporting causal execution without an explicit base revision and isolation backend.
