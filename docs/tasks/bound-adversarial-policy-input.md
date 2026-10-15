# Bound adversarial policy input

## Goal

Prevent oversized, type-confused, or ambiguously named repository configuration from
amplifying parser work or creating misleading execution evidence before any check runs.

## Requirements

1. Read task and configuration files through a reusable fixed-capacity regular-file reader so a file cannot cause an unbounded read between metadata validation and consumption. `change:src/review/bounded-file.ts` `change:src/review/task-parser.ts` `change:src/review/config.ts`
2. Bound configuration bytes, check/list cardinalities, command and identity text, and validate check booleans, network modes, environment names, and unique check identities. `change:src/review/config.ts`
3. Add corpus-driven adversarial policy tests for duplicate identities, bidirectional controls, environment assignment, scalar confusion, and network-mode forgery. `change:fixtures/adversarial/policy-input-cases.json` `change:tests/config.test.ts`
4. Exercise source, test-output, policy, repository-instruction, and prior-model-output injection surfaces through the structured prompt corpus. `change:fixtures/adversarial/prompt-injection-cases.json` `change:tests/prompt-boundary.test.ts`
5. Document both the new bounds and the remaining trusted-base/YAML-parser assumptions. `change:docs/DEVELOPMENT_PLAN.md` `change:docs/TRUST_MODEL.md` `change:docs/THREAT_MODEL.md`
