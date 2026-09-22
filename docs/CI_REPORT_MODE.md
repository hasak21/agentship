# GitHub CI report mode

AgentShip's initial CI workflow is intentionally artifact-only. It is designed to gather evidence from pull requests, including forks, before a repository grants AgentShip any merge authority.

## Architecture

1. `pull_request` starts a GitHub-hosted disposable runner with `contents: read`.
2. The pull request's base SHA is checked out under `verifier/`.
3. The pull-request subject is checked out separately under `subject/`.
4. AgentShip is built from `verifier/`; `.agentship.yml` is also loaded from that trusted checkout.
5. A base-owned script reads the GitHub event JSON and writes the PR body to a bounded temporary task document without shell interpolation.
6. The trusted executable enforces base-owned changed-file/diff limits, selects checks through base-owned `whenChanged` patterns, runs applicable checks against `subject/`, and records skipped checks explicitly.
7. JSON, Markdown, and SARIF reports are uploaded as workflow artifacts even when verification blocks.
8. The fixed Markdown report is appended to the workflow job summary without granting write permission to the repository.

All official actions are pinned to full commit SHAs. Dependency lifecycle scripts are disabled during installation. Subject checks still execute repository scripts because reproducing them is the purpose of the review.

`limits.maxChangedFiles` and `limits.maxDiffBytes` are pre-execution input bounds: exceeding either produces a blocker without running repository checks. Every check also has its own timeout and the job has a workflow timeout. These controls do not impose CPU, memory, disk, process-count, or network quotas.

Warning suppressions are also loaded from the base revision. A pull request cannot add a suppression that takes effect in its own report. Matching is exact on finding ID and kind; active owner, reason, and expiry evidence remains visible in every report format. Blocker kinds cannot be configured as suppressible.

The same boundary applies to blocking rules and protected paths: the workflow passes
`--config ../verifier/.agentship.yml` and never supplies `--approve-path` or
`--override`. A pull request can edit its own `.agentship.yml` or add approval-shaped
files, but neither becomes effective policy for that run. An executable regression
reviews a subject that replaces gate policy with a permissive report configuration and
proves the external trusted policy still emits the required-check and protected-path
blockers. Trusted maintainers may add an override workflow later, but it must load the
record from a trusted revision rather than the pull-request subject.

The CLI can compare a run with a prior JSON report through `--baseline`. It validates bounded report metadata and finding identities, records the baseline hash/run/commit, and classifies exact ID/kind pairs as new, existing, or resolved. Comparison is informational and cannot change the current verdict. The initial workflow does not yet fetch or select a historical artifact automatically.

## Required repository settings

- Use GitHub-hosted runners only.
- Do not send Actions secrets to fork pull-request workflows.
- Do not send write tokens to fork pull-request workflows.
- Do not replace `pull_request` with `pull_request_target`.
- Require maintainer approval for first-time contributors if desired.

## Residual risk

Untrusted checks can use the hosted runner's network and inspect files or ephemeral Actions runtime state available to their process. The workflow blanks common GitHub CLI token variables, but this is not OS-level network or credential isolation. Artifacts are unsigned, and SARIF remains an artifact rather than a code-scanning upload. A live fork pull request has not yet validated the workflow end to end. Do not reuse this workflow on a self-hosted runner or add secrets, deployments, package publishing, comments, labels, write permissions, or merge gating.

## Pull-request task format

AgentShip uses the pull-request body as its task document. To enable intent mapping, include numbered items under a `## Requirements` heading and use explicit evidence annotations where appropriate.

```markdown
## Requirements

1. Update `change:src/auth/session.ts`.
2. Add regression coverage in `change:tests/auth/session.test.ts`; require `check:test`.
```

If the body contains no requirements section, deterministic checks still run and the report records an empty task requirement set.
