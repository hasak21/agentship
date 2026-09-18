# Refresh the provider model catalog

## Objective

Replace obsolete provider presets and defaults with model IDs verified from current first-party catalogs while preserving each provider's existing protocol route.

## Requirements

1. [confirm] Update hosted/local presets, provider defaults, and the public MCP example under `change:src/lib/llm/**` and `change:src/app/api/mcp/route.ts`.
2. Keep Anthropic Messages, Gemini generateContent, and generic OpenAI-compatible behavior intact; adapt direct OpenAI GPT-5/6 Chat Completions parameters to the current contract.
3. Cover current preset IDs, defaults, and OpenAI request compatibility under `change:tests/llm-provider.test.ts`; require `check:test`, `check:lint`, and `check:build`.
4. Record the verification date, official sources, compatibility boundary, and environment override path through `change:docs/**` and `change:README.md`.

## Out of scope

- Migrating the client to OpenAI's Responses API.
- Live paid-provider calls or assumptions about account-specific model access.
- Rewriting historical benchmark or technical-report references.
