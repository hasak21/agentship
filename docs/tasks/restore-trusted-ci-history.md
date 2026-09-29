# Restore trusted CI review history

Restore the latest validated report for repeated pull-request reviews without granting
untrusted jobs a cache-write path or changing verdict semantics.

## Requirements

1. [confirm] Restore a PR-scoped history cache read-only before review and enable `--history` in `change:.github/workflows/agentship-report.yml`.
2. [confirm] Canonicalize a bounded, context-validated report and save it under a unique PR cache key only from `change:.github/workflows/agentship-publish-check.yml` and `change:scripts/build-check-run.mjs`.
3. [confirm] Prove cache access modes, immutable actions, matching key namespaces, validation-before-save ordering, and non-verdict baseline behavior in `change:tests/github-action.test.ts` and `change:tests/check-publisher.test.ts`; require `check:test` and `check:lint`.
4. Document cache trust, retention, task compatibility, poisoning limits, and recovery behavior in `change:docs/CI_REPORT_MODE.md`, `change:docs/BASELINES.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
5. [confirm] Reject history directories redirected through repository-controlled symbolic links before reading or writing in `change:src/review/history.ts`, `change:src/review/review.ts`, and `change:tests/history.test.ts`.

## Non-goals

- Treating cached reports as signed attestations.
- Allowing pull-request or `workflow_run` artifact bytes to write a cache before validation.
- Using baseline comparison to suppress findings or alter the current verdict.
