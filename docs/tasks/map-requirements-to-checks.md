# Map requirements to executed checks

## Objective

Bind explicit task requirements to captured check execution without presenting a passing command as semantic proof.

## Requirements

1. Extract explicit ``check:name`` annotations and map them after check execution in `change:src/review/requirement-mapper.ts` and `change:src/review/review.ts`.
2. Require every path and check annotation on a requirement to be satisfied.
3. Record passed, failed, timed-out, and unconfigured check evidence in `change:src/review/types.ts`.
4. Produce an evidence-backed warning for unsatisfied check annotations.
5. Cover check-only, mixed path-and-check, failed, and unconfigured cases in `change:tests/requirement-mapper.test.ts`, `change:tests/review.test.ts`, and `change:fixtures/intent/explicit-evidence-cases.json`; require `check:test` and `check:lint`.
6. Document that passing checks do not establish semantic correctness in `change:docs/TRUST_MODEL.md`.
7. Treat doubled-backtick syntax examples as documentation rather than active annotations.

## Out of scope

- Inferring which check should cover a requirement.
- Proving test-to-code behavioral coverage.
