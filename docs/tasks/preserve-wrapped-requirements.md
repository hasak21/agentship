# Preserve wrapped requirement clauses

## Requirements

1. Preserve indented continuation lines and nested list clauses inside their top-level requirement, retaining its original ID, starting line and confirmation marker. `change:src/review/task-parser.ts`
2. Use marker-width/tab-aware indentation, reject under-indented continuation ambiguity, and enforce the existing text-byte limit across the complete joined requirement. Keep fenced examples and outside prose/sections out of requirement evidence. `change:src/review/task-parser.ts`
3. Verify retained path/check/symbol annotations, inferred roles, nested numbering, fences, source lines, UTF-8 byte bounds and indentation boundaries. `change:tests/task-parser.test.ts`
4. Verify the bundled standalone review still flags the omitted wrapped test path even when the first-line implementation path changed and its smoke check passed. `change:scripts/verify-cli.mjs`
5. Document the supported Markdown subset and remaining semantic-verification limitation. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
