# Bound check output draining after termination

## Requirements

1. Reproduce a non-isolated POSIX check whose detached descendant inherits output pipes and outlives its shell. `change:tests/review.test.ts`
2. After the existing termination grace, force process-group termination and close outstanding output streams so inherited pipe handles cannot keep the verifier waiting indefinitely. Apply the same finalization to wall-clock and storage-triggered termination. `change:src/review/runner.ts`
3. Retain timeout/failure status, mark discarded output as truncated, and explain forced pipe closure in evidence. Never turn a zero shell exit with a deadline breach into PASS. `change:src/review/runner.ts` `change:tests/review.test.ts`
4. Document that output-drain bounds do not contain escaped direct-mode processes or replace aggregate kernel resource limits. `change:docs/TRUST_MODEL.md` `change:docs/DEVELOPMENT_PLAN.md`
