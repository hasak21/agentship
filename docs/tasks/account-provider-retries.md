# Account for provider transport retries

## Goal

Close the gap between research budget reservations and actual outgoing provider attempts.
Previously, one logical call reserved budget once while an internal retry could fetch twice.

## Requirements

1. Move research budget reservation into the shared provider transport so every HTTP attempt, including retries, reserves calls, prompt bytes, and output tokens before fetching. `change:src/lib/llm/client.ts` `change:src/lib/llm/types.ts` `change:src/app/api/research/route.ts`
2. Clamp retry backoff and per-attempt timeouts to the remaining shared lifetime, preserving typed budget failures through all provider adapters. `change:src/lib/llm/run-budget.ts` `change:src/lib/llm/client.ts`
3. Reproduce the one-call/two-fetch bypass and verify the fix with route-level SSE accounting, all three provider protocols, and retry deadline coverage. `change:tests/research-budget.test.ts` `change:tests/llm-provider.test.ts`
4. Update the development plan and trust contract with per-attempt accounting semantics. `change:docs/DEVELOPMENT_PLAN.md` `change:docs/TRUST_MODEL.md`

## Reproduction evidence

The route regression failed before the repair: with `AGENTSHIP_LLM_MAX_CALLS=1`, a mocked
503 response caused two fetches instead of one. After the repair the second attempt is
denied before fetch, final SSE evidence records one call, and the supervisor does not
retry the budget failure.
