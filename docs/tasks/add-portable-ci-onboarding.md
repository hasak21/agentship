# Add portable CI onboarding

## Goal

Allow an npm-based GitHub repository to install AgentShip's neutral two-stage CI flow
without copying or trusting verifier code from a pull-request branch.

## Acceptance criteria

1. `agentship ci-init` requires an immutable full commit SHA and emits a conservative,
   report-only policy plus minimal report and publisher caller workflows.
2. Installation refuses to overwrite any existing policy or workflow trust file.
3. Reusable workflows load verifier and publisher code from the pinned AgentShip source,
   while loading the effective policy from the target pull request's base SHA.
4. The untrusted report stage remains read-only and the publisher continues to treat its
   artifact only as bounded data.
5. Unit and standalone-bundle tests cover generation and refusal paths.

## Non-goals

- Supporting non-npm package managers in this first installer.
- Enabling merge-blocking enforcement or modifying repository settings.
- Claiming fork safety before a live fork pull-request validation.
