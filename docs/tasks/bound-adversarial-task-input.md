# Bound adversarial task input

## Goal

Treat local task files and pull-request-derived Markdown as hostile structured input before
it influences requirement mapping or human-readable evidence.

## Acceptance criteria

1. Bound task file bytes before allocating the full input and reject non-regular files.
2. Bound requirement count, text bytes, and numeric identities; reject duplicates, empty
   confirmation requirements, and ambiguous normalized IDs.
3. Ignore fenced Markdown examples when recognizing requirements and task directives.
4. Preserve hostile markup and bidirectional text as structured evidence while relying on
   the existing renderer boundary for display normalization.
5. Add a reusable adversarial fixture corpus plus focused byte/count/text-bound tests, and
   document the exact guarantee and remaining downstream-renderer responsibility.

## Non-goals

- Interpreting arbitrary Markdown semantics beyond the supported requirement format.
- Claiming semantic prompt-injection resistance for future model-assisted analysis.
