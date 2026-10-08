# GitHub CI report mode

AgentShip uses a two-stage report workflow. The first stage is intentionally secretless
and read-only while it executes pull-request code. A separate trusted publisher turns the
artifact into an always-neutral Check Run without granting merge authority.

## Architecture

1. `pull_request` starts a GitHub-hosted disposable runner with `contents: read`.
2. The pull request's base SHA is checked out under `verifier/`.
3. The pull-request subject is checked out separately under `subject/`.
4. AgentShip is built from `verifier/`; `.agentship.ci.yml` is also loaded from that trusted checkout.
5. A base-owned script reads the GitHub event JSON and writes the PR body to a bounded temporary task document without shell interpolation.
6. A trusted-base provisioner downloads one fixed Ubuntu Noble bubblewrap package over HTTPS, verifies its pinned SHA-256 before installation, rejects a setuid or wrong-version executable, and smoke-tests namespace creation.
7. The trusted executable enforces base-owned changed-file/diff limits, selects checks through base-owned `whenChanged` patterns, runs applicable checks in disposable bubblewrap workspaces with per-process limits and fresh network namespaces, and records skipped checks explicitly. Pinned local fonts keep the production build offline too.
8. The pull-request job has explicit read-only cache access and restores the newest PR-scoped, publisher-validated report into `.agentship/history`; a miss simply starts without a baseline.
9. JSON, Markdown, and SARIF reports are uploaded as workflow artifacts even when verification blocks.
10. The fixed Markdown report is appended to the workflow job summary without granting write permission to the repository.
11. A `workflow_run` job starts only after the named report workflow completes and GitHub associates exactly one pull request with it.
12. The publisher checks out only the default branch, downloads the named artifact from the exact triggering run, and parses event/report JSON under byte and finding-count bounds. Artifact contents are never executed.
13. After validation, the publisher canonicalizes the JSON into a fresh directory and saves it under a unique PR/run cache key using write-only cache access. Validation failure prevents the cache-save step.
14. The publisher binds the report base to the event's PR base and creates a Check Run on the event's PR head with `conclusion: neutral`, regardless of PASS, WARN, or BLOCK.

All official actions are pinned to full commit SHAs. Dependency lifecycle scripts are disabled during installation. Subject checks still execute repository scripts because reproducing them is the purpose of the review. The publisher has only `actions: read`, `contents: read`, and `checks: write`; the subject workflow retains only `contents: read`.

The JSON and Markdown reports record the canonical path, byte length, and SHA-256 of the
actual AgentShip entrypoint and launching Node executable. They also record bounded
platform, architecture, kernel, optional `/etc/os-release` identity/hash, and GitHub's
`RUNNER_ENVIRONMENT`, `RUNNER_OS`, `RUNNER_ARCH`, `ImageOS`, and `ImageVersion` fields when
present. In this workflow the entrypoint is the trusted base checkout's self-contained
`dist/agentship.cjs` bundle. The privileged publisher rejects missing, oversized, malformed,
or non-GitHub-hosted Linux X64 runner provenance and displays the verifier, image, OS, and
Node identities in the neutral Check Run summary. These fields identify claimed bytes and
environment metadata; they do not authenticate the unsigned artifact, prove that GitHub
issued the environment values, attest the image/kernel, or establish a reproducible bundle
build.

Task prose, repository paths, check labels, commands, finding titles, and human-entered
reasons are encoded before Markdown rendering. Control characters cannot create new
headings, and table/code values cannot introduce columns or raw HTML. JSON and SARIF
remain structured data; any downstream renderer must apply its own context-appropriate
encoding rather than trusting display strings.

The GitHub-hosted Ubuntu 24.04 image does not guarantee bubblewrap, so the trusted base
checkout provisions version `0.9.0-1ubuntu0.3` directly from Ubuntu's Noble security
archive. The script pins and checks the package's published SHA-256, installs without a
floating package-index update, verifies the package/runtime versions and non-setuid mode,
and exercises namespace creation before any pull-request command runs. The pin and digest
were checked against the
[Ubuntu Noble package record](https://packages.ubuntu.com/noble/amd64/bubblewrap/download)
on 2026-10-08. A package update is an explicit reviewed policy change.

`limits.maxChangedFiles` and `limits.maxDiffBytes` are pre-execution input bounds: exceeding either produces a blocker without running repository checks. Every check also has its own timeout and the job has a workflow timeout. The official Ubuntu policy uses `/usr/bin/prlimit` for per-process CPU time, maximum output-file size, and open-file counts; the workflow verifies that backend exists before review. AgentShip can also configure a virtual-address-space bound, but the official Node checks omit it because JavaScript/Wasm runtimes reserve large address ranges unrelated to resident memory. Limits are inherited by child processes but are not aggregated across the process tree. Bubblewrap adds PID/filesystem/network namespaces and a disposable workspace, but does not impose reliable memory, aggregate CPU, process-count, or disk-capacity quotas.

Warning suppressions are also loaded from the base revision. A pull request cannot add a suppression that takes effect in its own report. Matching is exact on finding ID and kind; active owner, reason, and expiry evidence remains visible in every report format. Blocker kinds cannot be configured as suppressible.

The same boundary applies to blocking rules and protected paths: the workflow passes
`--config ../verifier/.agentship.ci.yml` and never supplies `--approve-path` or
`--override`. A pull request can edit its own `.agentship.yml` or add approval-shaped
files, but neither becomes effective policy for that run. An executable regression
reviews a subject that replaces gate policy with a permissive report configuration and
proves the external trusted policy still emits the required-check and protected-path
blockers. Trusted maintainers may add an override workflow later, but it must load the
record from a trusted revision rather than the pull-request subject.

The CLI can compare a run with a prior JSON report through `--baseline`. It validates bounded report metadata and finding identities, records the baseline hash/run/commit, and classifies exact ID/kind pairs as new, existing, or resolved. Comparison is informational and cannot change the current verdict. Local `--history` mode durably records all report formats and automatically selects the newest report with the same configuration/task hashes, scope, and base. CI uses that same compatibility check after a restore, so an edited PR task or changed base/policy safely yields no automatic baseline. Only the latest validated report is carried forward; cache eviction or a miss degrades to a normal history-free review.

The cache split follows GitHub's low-trust guidance: the `pull_request` job declares `cache-mode: read` and uses only `actions/cache/restore`, while the publisher declares `cache-mode: write-only` and uses only `actions/cache/save`. Both actions are pinned to the full v6.1.0 commit. GitHub scopes caches by key/version/branch and searches the current PR scope before the base/default branch, so repositories must not let another untrusted workflow create the `agentship-history-v1-pr-` namespace. The report workflow itself cannot write because its cache token is read-only, and AgentShip rejects a history directory redirected through a repository-controlled symbolic link. Verified against the [GitHub dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) on 2026-09-29.

## Required repository settings

- Use GitHub-hosted runners only.
- Do not send Actions secrets to fork pull-request workflows.
- Do not send write tokens to fork pull-request workflows.
- Keep Check Run publication in the separate `workflow_run` publisher; never move its write permission into the subject workflow.
- Do not configure `AgentShip evidence report` as a required check; its neutral conclusion communicates report availability, not policy approval.
- Do not replace `pull_request` with `pull_request_target`.
- Require maintainer approval for first-time contributors if desired.

## Residual risk

Dependency installation still processes attacker-selected package metadata with network access outside the sandbox, although lifecycle scripts are disabled. Every configured check receives a fresh network namespace; the production build uses pinned local Geist assets and no longer needs a host-network exception. Bubblewrap shares the host kernel and is not a VM, and its writable tmpfs/disposable copy still lack hard disk-capacity and cgroup-wide resource quotas. Artifacts and caches are unsigned and may be attacker-influenced despite structural validation, so the privileged publisher never executes their content and the restored baseline remains informational. A repository-level workflow outside this design could populate the same key namespace in a PR scope; workflow protection and namespace ownership remain operator responsibilities. SARIF remains an artifact rather than a code-scanning upload. A live fork pull request has not yet validated the two-stage workflow end to end. Do not reuse the subject workflow on a self-hosted runner or add secrets, deployments, package publishing, comments, labels, write permissions, or merge gating.

## Pull-request task format

AgentShip uses the pull-request body as its task document. To enable intent mapping, include numbered items under a `## Requirements` heading and use explicit evidence annotations where appropriate.

```markdown
## Requirements

1. Update `change:src/auth/session.ts`.
2. Add regression coverage in `change:tests/auth/session.test.ts`; require `check:test`.
```

If the body contains no requirements section, deterministic checks still run and the report records an empty task requirement set.
