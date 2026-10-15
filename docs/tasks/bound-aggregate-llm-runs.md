# Bound aggregate LLM runs

## Goal

Prevent one research request from multiplying provider calls, prompt volume, output-token
reservations, or elapsed time across topology fan-outs, critic passes, comparisons, and
judges without a shared upper bound.

## Requirements

1. Add a request-scoped budget with validated call, prompt-byte, reserved-output-token, reported-token, and wall-clock limits. `change:src/lib/llm/run-budget.ts`
2. Share one budget across every research topology branch and clamp each provider timeout to the remaining run lifetime. `change:src/app/api/research/route.ts`
3. Stop subsequent calls after exhaustion without retrying budget failures, and emit start/final SSE budget evidence. `change:src/app/api/research/route.ts`
4. Cover atomic reservations, exhaustion, deadline clamping, environment validation, streamed evidence, and fan-out termination. `change:tests/llm-run-budget.test.ts` `change:tests/research-budget.test.ts`
5. Document the guarantee and distinguish resource proxies from provider-authenticated usage or currency limits. `change:README.md` `change:docs/DEVELOPMENT_PLAN.md` `change:docs/TRUST_MODEL.md` `change:docs/THREAT_MODEL.md`
