# Publish a non-blocking Check Run

## Objective

Expose the existing CI evidence report on the pull-request commit without allowing
untrusted pull-request code to receive a write token or turn report mode into a gate.

## Requirements

1. Trigger a separate trusted `workflow_run` publisher after the read-only report workflow.
2. Download only that run's named evidence artifact and never execute artifact contents.
3. Validate bounded event/report JSON and bind the Check Run to the event's pull-request head SHA.
4. Publish through `checks: write` with an always-neutral conclusion and a link to the source workflow run.
5. Pin every action to a full commit SHA and cover trust-boundary invariants in tests.

## Out of scope

- Merge gating or failure conclusions.
- Executing pull-request code in the privileged publisher.
- Publishing when GitHub does not associate exactly one pull request with the workflow run.
