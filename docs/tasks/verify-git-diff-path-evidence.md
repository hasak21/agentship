# Verify Git diff path evidence boundaries

## Requirements

1. Preserve decoded quoted UTF-8 filename bytes including a leading BOM, reject raw control characters and malformed/invalid UTF-8 escapes, and keep trailing spaces distinct from Git's tab field separator. `change:src/review/git-diff-evidence.ts` `change:tests/git-diff-evidence.test.ts`
2. Retain file attribution across text hunks, quoted binary deletion, rename metadata and type-change records, without accepting hunk text as path metadata or fabricating symbol lines for binary/rename-only changes. `change:tests/git-diff-evidence.test.ts`
3. Append repeated-record evidence without copying the accumulated line array on each record; verify 10,000 repeated records and final file state. `change:src/review/git-diff-evidence.ts` `change:tests/git-diff-evidence.test.ts`
4. Verify real Git binary deletion/quoted rename/symlink-to-file changes in staged and base scopes, plus a standalone CLI review of a Chinese/quote-containing symbol path. `change:tests/git.test.ts` `change:scripts/verify-cli.mjs`
5. Record completed path-evidence work and its lexical/non-semantic limitations. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
6. Read NUL-delimited Git filename lists as bytes, reject invalid UTF-8 without replacement aliases in working-tree (tracked and untracked), staged and base scopes, and preserve valid tracked BOM/replacement-character filenames with real-repository regressions. `change:src/review/git.ts` `change:tests/git.test.ts`
7. Fail task requirements and options preflight on unclosed fences with opening source lines, even after a strict-coverage directive; retain matching longer closures and following requirement lines, test standalone CLI refusal without report publication, and document the deliberately strict task format. `change:src/review/task-parser.ts` `change:tests/task-parser.test.ts` `change:scripts/verify-cli.mjs` `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
