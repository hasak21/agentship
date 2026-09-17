<!-- agentship: strict-change-coverage -->

# Bootstrap fork-safe CI report mode

## Objective

Complete the intent-verification batch and add a secretless, trusted-base GitHub pull-request report workflow.

## Requirements

1. [confirm] Preserve the reviewed core, policy, CLI, package, and local configuration changes across `change:src/**`, `change:package.json`, and `change:.agentship.yml`.
2. Preserve the executable and scenario corpora under `change:fixtures/**`.
3. Add the full-SHA-pinned, read-only workflow and trusted task extraction under `change:.github/**` and `change:scripts/**`.
4. Cover configuration, benchmark, mapping, policy, workflow, and task extraction behavior under `change:tests/**`; require `check:test`, `check:lint`, and `check:cli-package`.
5. Record roadmap, trust, threat, CI usage, and task decisions throughout `change:docs/**` and `change:README.md`.

## Out of scope

- Check Run or pull-request comment publication.
- Secrets, write tokens, self-hosted runners, or merge gating.
- Claiming representative benchmark accuracy without external validation.
