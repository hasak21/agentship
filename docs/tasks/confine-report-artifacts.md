# Confine report and history artifacts

## Requirements

1. Reproduce and reject CI-style report output through a repository link to an external sentinel. `change:tests/review.test.ts`
2. Restrict review output to repository child paths outside Git administration, traverse Linux ancestors using pinned no-follow directory descriptors, reject linked/special leaves, and publish through exclusively created private temporary files plus per-file atomic rename. `change:src/review/artifact-output.ts`
3. Preflight all artifact targets before publication, protect destination hardlink aliases, and use the same safe directory creation and writer for history artifacts. `change:src/review/review.ts` `change:src/review/history.ts`
4. Verify normal publication/replacement, link ancestors/leaves, hardlinks, directory creation, external-path rejection and batch preflight. `change:tests/artifact-output.test.ts`
5. Document output compatibility, platform and atomicity limitations without claiming hostile-host isolation complete. `change:src/cli/index.ts` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
