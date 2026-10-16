# Validate explicit evidence annotations

## Requirements

1. Preserve explicit root/extensionless paths and filenames with internal spaces, dotfiles and literal route brackets; retain exact-file and directory/** behavior. `change:src/review/evidence-annotations.ts` `change:src/review/requirement-mapper.ts`
2. Reject empty, unsafe, unsupported, multiline or unclosed recognized evidence annotations, while respecting complete code-span boundaries and escaped/multi-backtick examples. `change:src/review/evidence-annotations.ts`
3. Validate complete task requirements before repository commands execute, retaining parent requirement IDs in actionable errors. `change:src/review/task-parser.ts` `change:tests/review.test.ts`
4. Verify path/check/symbol identity bounds, malformed-input cases and standalone CLI missing-path/rejection behavior without changing historical benchmark corpora. `change:tests/evidence-annotations.test.ts` `change:tests/requirement-mapper.test.ts` `change:scripts/verify-cli.mjs`
5. Document syntax compatibility and the retained path-only/lexical evidence boundary. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
