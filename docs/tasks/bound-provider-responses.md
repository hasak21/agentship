# Bound provider responses

## Goal

Prevent a slow or compromised LLM provider from holding response bodies open indefinitely
or forcing AgentShip to buffer unbounded JSON and model output.

## Requirements

1. Apply a validated default output-token ceiling consistently to OpenAI-compatible, Anthropic, and Gemini requests. `change:src/lib/llm/client.ts`
2. Read success and error responses through one streaming byte cap, reject invalid UTF-8/JSON, and cancel declared or observed excess. `change:src/lib/llm/client.ts`
3. Keep the provider abort deadline active until the bounded response body is fully consumed. `change:src/lib/llm/client.ts`
4. Test default limits for every protocol, exact and oversized bodies, cancellation, malformed UTF-8, invalid token bounds, and a stalled response body. `change:tests/llm-provider.test.ts`
5. Document the per-call guarantee without claiming aggregate rate or spending enforcement. `change:README.md` `change:docs/TRUST_MODEL.md` `change:docs/THREAT_MODEL.md`
