# Add compatible report history

Persist repeated local reviews and automatically compare only runs with the same
review context.

## Requirements

1. Select the newest compatible bounded history report by configuration hash, task hash, review scope, and base in `change:src/review/history.ts`.
2. Record JSON, Markdown, and SARIF history and expose evidence through `change:src/review/review.ts` and `change:src/review/types.ts`.
3. Add `--history` to `change:src/cli/index.ts`, verify it in `change:scripts/verify-cli.mjs`, and ignore local history through `change:.gitignore`.
4. Cover path containment, missing history, incompatible newer reports, durable artifacts, and automatic comparison in `change:tests/history.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document compatibility and provenance limits in `change:README.md`, `change:docs/BASELINES.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
