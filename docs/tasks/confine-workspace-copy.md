# Confine sandbox workspace copying

## Requirements

1. Reproduce and reject Git-index paths beneath a working-tree directory replaced with a symbolic link, without touching the external sentinel. `change:tests/workspace-copy.test.ts`
2. Traverse source and destination paths using pinned Linux directory descriptors, preserve leaf-link metadata without dereferencing it, reject special/multiply linked sources, and create regular destinations exclusively. `change:src/review/workspace-copy.ts` `change:src/review/sandbox.ts`
3. Bound selected paths and projected parent directories to 200,000 entries, count actual streamed bytes including link targets against 2 GiB, and reject observed source mutation. Test overrides may only tighten limits. `change:src/review/workspace-copy.ts`
4. Verify executable modes, raw link bytes, tracked/untracked files, ignored/omitted inputs, deleted paths, hostile filenames, destination links, FIFOs, hardlinks and entry/byte budgets. `change:tests/workspace-copy.test.ts`
5. Update the development plan and trust boundary without claiming concurrent hostile-host, dependency-tree or kernel isolation complete. `change:docs/DEVELOPMENT_PLAN.md` `change:docs/TRUST_MODEL.md`
