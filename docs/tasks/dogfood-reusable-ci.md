# Dogfood reusable CI workflows

## Goal

Make AgentShip use the same immutable minimal workflow callers installed by `ci-init`,
eliminating duplicated report and publisher implementations before live validation.

## Acceptance criteria

1. The report caller grants only `contents: read` and pins the reusable report workflow
   plus verifier input to the same full AgentShip commit SHA.
2. The publisher caller retains only its documented permissions and pins the reusable
   publisher workflow plus verifier input to that same commit SHA.
3. Detailed isolation, artifact validation, attestation, and Check Run logic remains in
   the reusable workflows with regression coverage.
4. Documentation describes verifier, target-base policy, and subject as separate trust
   roots.
5. A temporary pull request exercises both callers after the migration reaches `main`.
