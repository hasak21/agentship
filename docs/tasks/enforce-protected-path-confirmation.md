# Enforce protected-path confirmation

## Objective

Require an explicit operator decision when task evidence touches repository-designated high-impact paths.

## Requirements

1. Enforce protected-path confirmation, record its basis, and validate repository-relative patterns throughout `change:src/review/**` and `change:.agentship.yml`.
2. Cover exact paths, trailing directory patterns, invalid patterns, file evidence, symbol evidence, pending confirmation, and confirmed states in `change:tests/**`; require `check:test` and `check:lint`.
3. Document unauthenticated confirmation and mutable-policy limitations in `change:docs/**` and `change:README.md`.

## Out of scope

- Authenticated actor identity or signatures.
- Loading policy from an immutable base revision.
