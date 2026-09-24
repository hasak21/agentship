# Track finding outcomes

Create durable calibration events for human dispositions and evidence-backed finding
resolution.

## Requirements

1. Record bounded, immutable accepted, rejected, fixed, and overridden events bound to exact report and finding evidence in `change:src/review/outcome.ts`.
2. Require compatible resolution-report evidence for fixed findings and retained override evidence for overridden findings in `change:src/review/outcome.ts`.
3. Expose outcome recording through `change:src/cli/index.ts`, verify the standalone command through `change:scripts/verify-cli.mjs`, and ignore local records through `change:.gitignore`.
4. Cover report binding, exclusive writes, fixed and override evidence, compatibility, and repository path containment in `change:tests/outcome.test.ts`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Document outcome semantics, unauthenticated actor claims, and calibration limits in `change:README.md`, `change:docs/OUTCOMES.md`, `change:docs/TRUST_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.
