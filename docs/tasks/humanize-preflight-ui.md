# Humanize the preflight interface

Make the default web experience understandable to an individual developer who
wants to verify an agent-written change.

## Requirements

1. Lead with task intent, the actual Git diff, preflight state, and clear next actions in `change:src/app/page.tsx`.
2. Distinguish deterministic CLI evidence from advisory model findings throughout `change:src/app/page.tsx`, `change:src/components/audit/AuditReportCard.tsx`, and `change:src/components/diff/DiffViewer.tsx`.
3. Keep model experiments and integration instructions available without making them the primary workflow.
4. Verify the production UI with `check:lint`, `check:test`, and `check:build`.
