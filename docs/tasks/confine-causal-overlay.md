# Confine causal test overlays before sandbox execution

## Requirements

1. Replace path-following causal test copies with Linux descriptor-rooted, no-follow traversal for both source and base worktree; reject symlink ancestors/leaves and non-regular or multiply linked sources. `change:src/review/causal-overlay.ts` `change:src/review/review.ts`
2. Use exclusive temporary files and atomic destination-entry replacement, preserving executable permissions without truncating existing hardlinked inodes. Delete absent-source counterparts without following external links. `change:src/review/causal-overlay.ts`
3. Enforce normalized relative paths and limits of 256 unique paths, 16 MiB per source and 64 MiB copied bytes; bound copy buffers, reject observed source mutation and clean temporary files/descriptors on failure. `change:src/review/causal-overlay.ts`
4. Verify symlink/hardlink attacks, copies/deletions, permissions and budgets, plus a real causal review that refuses a linked base directory and removes its temporary worktree. `change:tests/causal-overlay.test.ts` `change:tests/review.test.ts`
5. Document Linux/procfs requirements, conservative rejections and residual host-mutation boundaries without claiming hostile maintainer mode complete. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
