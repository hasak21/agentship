# AgentShip Verify Development Plan

## Product thesis

AgentShip independently verifies whether agent-written code is ready to ship and produces evidence for every decision. The adoption path is personal preflight, team report mode, policy gate, maintainer filter, and finally enterprise audit infrastructure.

## Progress legend

- `[ ]` planned
- `[~]` in progress
- `[x]` delivered

## M0 — Trust contract and product reset

- [x] Define claimed, inferred, observed, reproduced, and attested evidence.
- [x] Replace numerical quality scores in the core decision model with PASS, WARN, and BLOCK.
- [x] Document the trusted-local-checkout boundary.
- [x] Complete the hostile-repository and forked-PR threat model.
- [x] Update the web product language from orchestration lab to AgentShip Verify.
- [x] Bind locally by default and add bounded, optionally authenticated API requests.
- [x] Abort stalled upstream LLM requests before supervisor retries.

Exit criterion: no AgentShip report presents model output as executed evidence.

## M1 — Local deterministic review

- [x] Add `.agentship.yml` version 1.
- [x] Add `agentship review` through the local npm script.
- [x] Capture Git, task, configuration, command, exit, timing, and bounded-output evidence.
- [x] Emit JSON and Markdown evidence artifacts.
- [x] Keep report mode non-blocking and make gate mode return a failing exit code on BLOCK.
- [x] Add portable process-tree cancellation.
- [x] Add environment allowlisting and secret redaction.
- [x] Detect and block repository mutation during verification checks.
- [x] Package a standalone executable.

Exit criterion: a developer can prove whether configured checks actually ran and passed without starting a server or calling a model.

## M2 — Dogfood AgentShip

- [x] Add the repository's own policy and bootstrap task.
- [x] Run the first self-review and retain the artifact locally.
- [x] Add a regression test for the self-consistency routing fallthrough.
- [x] Fix the self-consistency routing defect under AgentShip review.
- [x] Fix outbound provider URL and credential handling under AgentShip review.

Exit criterion: changes to AgentShip routinely carry an independently produced verification report.

## M3 — Intent-to-diff verification

- [x] Parse task documents into individually addressable requirements.
- [x] Require confirmation for task-marked ambiguity and requirements touching configured high-impact protected paths.
- [x] Map requirements to files, symbols, tests, and documentation through explicit path/check/symbol evidence and labeled test/documentation role inference.
- [x] Identify explicit/inferred omissions and opt-in strict unattributed changes while keeping semantic relevance claims out of deterministic evidence.
- [~] Measure omission recall and false-positive rate (corpus-hashed 12-case executable baseline delivered at 0.667 precision/recall; representative external corpus pending).

Exit criterion: omitted requirements are detected with measured, publishable accuracy.

## M4 — CI report mode

- [~] Build a fork-safe GitHub Action (trusted-base, read-only, artifact-only report workflow delivered; live fork-PR validation pending).
- [~] Publish Check Run, Markdown, JSON, and SARIF outputs (Markdown/JSON/SARIF artifacts and a job summary are delivered; Check Run publication remains pending).
- [~] Add changed-path filtering and execution budgets (deterministic check selection, pre-execution changed-file/diff limits, and wall-clock timeouts delivered; isolated CPU/memory/process quotas remain pending).
- [~] Add baselines, suppressions with ownership, and report history (bounded hash-bound baseline comparison and exact warning suppressions with owner/reason/expiry delivered; automatic baseline selection and durable history pending).

Exit criterion: a team can install AgentShip without granting merge-blocking authority.

## M5 — Policy gate

- [x] Make blocking rules explicit and repository-owned.
- [x] Add protected-path and manual-approval policies.
- [x] Record overrides with actor, reason, report hash, and expiry.
- [x] Prevent untrusted changes from weakening the effective policy.

Exit criterion: teams can enable gate mode without trusting an LLM verdict.

## M6 — Adversarial maintainer mode

- [ ] Execute untrusted checks in isolated, resource-limited workers.
- [ ] Enforce network denial and secret isolation (version 1 only records declared network capability).
- [ ] Treat source, task text, tests, and repository instructions as hostile inputs.
- [ ] Sign evidence manifests and preserve verifier provenance.

Exit criterion: a malicious pull request cannot escape the runner, obtain secrets, or approve itself.

## M7 — Calibration and public benchmark

- [x] Build a seeded-defect patch corpus with 12 declarative before/after patches, independently executed file oracles, and a standalone runner.
- [ ] Track accepted, rejected, fixed, and overridden findings.
- [ ] Measure evidence-backed precision, recall, false blocks, and triage time.
- [ ] Publish a reproducible coding-agent trust leaderboard.

Exit criterion: product and model-comparison claims are supported by reproducible measurements.

## Product metrics

- Evidence-backed blocker precision
- Missed-requirement recall
- False blocks per 100 reviews
- Median time to understand and reproduce a finding
- Regressions caught before merge
- Human override rate and subsequent outcomes
