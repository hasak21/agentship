# Isolate untrusted model prompt inputs

## Goal

Keep caller-controlled and model-derived text out of trusted system instructions across
AgentShip's production provider call sites without overstating probabilistic isolation as
a deterministic security boundary.

## Requirements

1. Add one reusable prompt-boundary helper that preserves fixed instructions in the system role and JSON-serializes the caller objective separately from untrusted reference data. `change:src/lib/llm/prompt-boundary.ts`
2. Route the audit, research, and MCP model calls through the shared boundary, and allowlist caller-supplied topology labels before they influence orchestration. `change:src/lib/auditor.ts` `change:src/app/api/research/route.ts` `change:src/app/api/mcp/route.ts`
3. Add an adversarial corpus and tests proving role-like prose, markup, fences, bidirectional characters, and JSON-looking delimiters remain data and never enter system instructions. `change:fixtures/adversarial/prompt-injection-cases.json` `change:tests/prompt-boundary.test.ts`
4. Document both the mitigation and its residual probabilistic limitation in the roadmap and trust/threat guidance. `change:docs/DEVELOPMENT_PLAN.md` `change:docs/TRUST_MODEL.md` `change:docs/THREAT_MODEL.md`
