# Prevent Markdown report forgery

Keep hostile repository and pull-request data visibly subordinate to AgentShip's fixed
report structure.

## Requirements

1. [confirm] Normalize control characters and contextually encode untrusted prose and code-like values before Markdown output in `change:src/review/review.ts`.
2. Prove task/finding text cannot create a forged heading, raw HTML, or extra check-table column in `change:tests/review.test.ts`; require `check:test` and `check:lint`.
3. Document the renderer boundary and remaining consumer obligations in `change:docs/CI_REPORT_MODE.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Sanitizing JSON by changing evidence values.
- Claiming prompt-injection resistance for future model-assisted analysis.
- Trusting Markdown escaping as an HTML sanitizer outside AgentShip's fixed renderer.
