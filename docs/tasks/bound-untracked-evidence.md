# Bound untracked Git evidence without dereferencing links

## Requirements

1. Capture all Git path lists with NUL separators so whitespace, quotes and newlines remain exact paths across working-tree, staged and base modes. `change:src/review/git.ts`
2. Replace concurrent whole-file untracked reads with sequential fixed-buffer hashing and explicit file/count/aggregate limits. Capture kind, mode, bytes and SHA-256 in JSON-escaped single-line records. `change:src/review/untracked-evidence.ts` `change:src/review/git.ts`
3. Hash symbolic-link target text rather than referenced contents; reject special files, multiply linked regular files and linked ancestors, and abort on observed file changes. Reuse Linux descriptor-rooted traversal with the causal overlay. `change:src/review/repository-directory.ts` `change:src/review/causal-overlay.ts` `change:src/review/untracked-evidence.ts`
4. Verify external target independence, broken links, actual FIFOs, byte/count budgets, mode evidence and hostile filenames through unit and real Git tests. `change:tests/git.test.ts` `change:tests/untracked-evidence.test.ts`
5. Document limits, record-format compatibility and remaining pre-sandbox/concurrent-host risks. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
