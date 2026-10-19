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
- [x] Bound upstream LLM calls with whole-response deadlines, a 4 MiB streaming response limit, strict UTF-8/JSON parsing, and a cross-provider 4,096-token default.
- [x] Bound each research run across topology fan-outs, critic passes, comparisons, and judges by calls, prompt bytes, reserved/reported tokens, and total wall-clock duration, with streamed budget evidence.
- [x] Charge provider transport retries to the shared research budget and clamp retry backoff to the remaining run lifetime; preserve budget errors through provider wrappers.

Exit criterion: no AgentShip report presents model output as executed evidence.

## M1 — Local deterministic review

- [x] Add `.agentship.yml` version 1.
- [x] Add `agentship review` through the local npm script.
- [x] Capture Git, task, configuration, command, exit, timing, and bounded-output evidence.
- [x] Emit JSON and Markdown evidence artifacts.
- [x] Keep report mode non-blocking and make gate mode return a failing exit code on BLOCK.
- [x] Add portable process-tree cancellation.
- [x] Bound inherited output-pipe draining after timeout/resource termination, preserving failure/truncation evidence even when a direct-mode descendant escapes the process group; detached-process containment remains outside direct-mode guarantees.
- [x] Add environment allowlisting and secret redaction.
- [x] Detect and block repository mutation during verification checks.
- [x] Package a standalone executable.
- [x] Add non-destructive local policy initialization and read-only environment diagnostics.

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
- [x] Preserve wrapped and nested requirement clauses with stable top-level IDs/source lines, marker-aware indentation and aggregate text bounds; verify a wrapped missing-test clause through the standalone CLI rather than dropping it after a passing smoke check.
- [x] Reject unclosed task code fences with opening source lines in requirement/options preflight (including after an enabled coverage directive); verify mismatched/short closures, valid longer closures and standalone CLI refusal without report publication.
- [x] Reject invalid UTF-8 task bytes before parsing rather than replacement-decoding path requirements; retain exact source bytes (including BOM and valid replacement characters) for hashing and verify standalone CLI refusal without report publication.
- [x] Require confirmation for task-marked ambiguity and requirements touching configured high-impact protected paths.
- [x] Map requirements to files, symbols, tests, and documentation through explicit path/check/symbol evidence and labeled test/documentation role inference.
- [x] Decode standard Git quoted UTF-8 path metadata for symbol/deletion evidence; preserve BOM/space identity, reject malformed fields, handle binary deletion/rename/type changes, and verify real Git plus standalone CLI paths without upgrading lexical evidence to semantic proof.
- [x] Decode NUL-delimited Git path lists from raw bytes with fatal UTF-8 validation across working-tree/staged/base scopes; reject invalid-byte filename aliases while preserving valid tracked replacement characters and leading BOMs, with real-repository regressions.
- [x] Preserve extensionless/root and space-containing explicit paths, and reject malformed recognized annotations during task preflight instead of silently dropping mandates; retain code-span examples as context and verify the standalone CLI.
- [x] Identify explicit/inferred omissions and opt-in strict unattributed changes while keeping semantic relevance claims out of deterministic evidence.
- [x] Exclude known deleted files and the task input from inferred test/documentation role evidence; retain exclusions in reports and verify working-tree/staged/base behavior with a separate four-case file-oracle regression suite. Content-level semantic adequacy remains unverified.
- [x] Add opt-in causal regression checks that retain pass-on-head/fail-on-base evidence with explicit test overlays.
- [x] Pin base-scope diffs to resolved head/unique merge-base commits, retain initial/post-check reference identities, reuse the pinned commit for causal worktrees and post-check diff capture, and block reference drift even when head/diff bytes are unchanged. Reject ambiguous merge-base histories and verify actual Git plus standalone CLI provenance.
- [x] Reject dirty tracked inputs before base-scope commands, including staged/index-only edits, hidden assume-unchanged/skip-worktree state and POSIX executable-mode changes despite `core.filemode=false`; recheck after execution and retain tracked-state integrity failures even when committed diff bytes are unchanged. Verify marker non-execution and standalone CLI refusal/clean success.
- [ ] Isolate local base-scope head execution from untracked/ignored helper inputs and transient host mutation; pre/post tracked-state guards are not an immutable head execution snapshot, and dependency mounts remain separately trusted.
- [x] Classify causal base failures and reject zero/signal/ambiguous-shell exits, resource/accounting violations and recorded sandbox cleanup failures, with retained reasons; assertion-level failure attribution remains unverified.
- [~] Measure omission recall and false-positive rate (12-case synthetic baseline at 0.667 precision/recall; preserved 20-case external baseline exposes zero recall and one resolved-candidate flag; clause-aware repair removes that development-set flag, and a disjoint 16-case/eight-repository holdout detects one of three unresolved candidates with zero resolved-candidate flags; representative coverage, semantic omission adjudication, and broader independent evaluation remain pending).

Exit criterion: omitted requirements are detected with measured, publishable accuracy.

## M4 — CI report mode

- [~] Add non-destructive team onboarding (npm lockfile validation, conservative CI policy, immutable verifier pin, minimal reusable-workflow callers, unit coverage, disposable-repository installation, a dependency-free cross-repository validation fixture with clean/regressed local bubblewrap preflight, and live first-party reusable report/publisher validation delivered; hosted cross-repository validation pending).
- [~] Build a fork-safe GitHub Action (trusted-base, exact-head, read-only, artifact-only report workflow delivered and live same-repository PR validated; live fork-PR validation pending).
- [~] Publish Check Run, Markdown, JSON, and SARIF outputs (artifact/job-summary outputs and a separate bounded, always-neutral `workflow_run` Check Run publisher with attested canonical JSON and Sigstore bundle are live-validated through both direct and reusable same-repository flows; live fork-PR validation remains pending).
- [~] Add changed-path filtering and execution budgets (deterministic check selection, pre-execution changed-file/diff limits, per-check plus cumulative check wall-clock deadlines, Linux per-process limits, digest-pinned disposable bubblewrap workers, and a fail-closed sampled aggregate writable-storage budget in official CI delivered; aggregate cgroup accounting and hard disk-capacity quotas remain pending).
- [x] Add baselines, suppressions with ownership, and report history (bounded comparison, owned suppressions, compatible local history, and validated publisher-written/read-only PR cache restoration delivered).

Exit criterion: a team can install AgentShip without granting merge-blocking authority.

## M5 — Policy gate

- [x] Make blocking rules explicit and repository-owned.
- [x] Add protected-path and manual-approval policies.
- [x] Record overrides with actor, reason, report hash, and expiry.
- [x] Reject invalid UTF-8 in baseline/history/override JSON (including correctly hash-bound malformed override source reports), preserving valid source digests and rejecting writerless baseline/override FIFOs with bounded reads.
- [x] Prevent untrusted changes from weakening the effective policy.

Exit criterion: teams can enable gate mode without trusting an LLM verdict.

## M6 — Adversarial maintainer mode

- [x] Confine review/history publication to repository children with Linux descriptor-rooted parent traversal, linked-leaf rejection, private exclusive staging and per-file atomic replacement; verify CI-style output redirects and external hardlink preservation. Multi-file transactions and concurrent hostile-host isolation remain outside this boundary.
- [x] Extend confined publication to outcome/missed-finding audit events: reject linked ancestors and Git administration destinations before external directory creation, stage complete private bytes, then publish through an atomic no-overwrite hard link. Verify concurrent duplicate writers, unchanged linked leaves and temporary-file cleanup; this is not a host-enforced append-only store or directory crash-durability guarantee.
- [x] Prevent host-side default/custom post-checkout hooks while preparing causal worktrees by using a private empty hooks directory and non-recursive submodule configuration; disable filesystem-monitor hooks per Git evidence/workspace-enumeration invocation without changing repository config. Verify actual active hooks, unchanged configuration and captured/copied changed source.
- [x] Refuse active Git filter attributes before host-side diff conversion; create temporary worktrees without checkout, populate only their private index, inspect the target commit's cached attributes, and materialize only filter-free trees. Verify active clean/smudge/process controls, historical attribute differences, sentinel-name bypasses, unused-driver compatibility and registration cleanup without changing repository configuration.
- [ ] Support required filter transformations in isolated materialization, and bound other native Git preparation I/O/resource behavior before claiming a complete checkout sandbox; active filter-based repositories currently fail closed.

- [x] Bound and type untracked working-tree evidence with streaming hashes, link-target-only capture, exact NUL-delimited path lists and Linux no-follow ancestor traversal; retain hostile-filename and FIFO regressions.
- [x] Extend descriptor-rooted source/destination confinement to sandbox workspace copying, with no-follow ancestor traversal, exclusive destination creation, raw leaf-link metadata, bounded streaming and projected-directory accounting; retain linked-ancestor/hardlink/FIFO regressions. Dependency mounts and concurrent hostile host mutation remain outside this completed boundary.

- [x] Confine host-side causal test overlays with Linux descriptor-rooted/no-follow traversal, atomic destination replacement and bounded copying; verify symlink escapes, destination hardlinks and real-review worktree cleanup. Concurrent hostile host mutation and stronger worker boundaries remain pending.

- [~] Execute untrusted checks in isolated, resource-limited workers (Linux bubblewrap disposable-copy backend composes with `prlimit` and sampled aggregate writable-storage enforcement, and official CI installs a fixed SHA-256-verified Ubuntu package; stronger kernel/VM, hard disk quota, and aggregate cgroup boundaries remain pending).
- [~] Enforce network denial and secret isolation (all official checks use fresh network namespaces and minimal filesystems with no host home or `/etc`, including a live GitHub-hosted same-repository PR run and an offline build backed by pinned local fonts; dependency installation, fork-specific behavior, and non-isolated local checks remain outside completed validation).
- [~] Treat source, task text, tests, and repository instructions as hostile inputs (bounded fence-aware task/configuration parsing, Markdown report anti-forgery escaping, JSON prompt envelopes with trusted-system/untrusted-data separation across production model call sites, policy identity/cardinality validation, and adversarial task/source/test/policy prompt corpora delivered; deeper source-language semantics and deterministic model-content defenses remain pending).
- [x] Open bounded task/configuration/adjudication inputs nonblocking before descriptor type validation, rejecting writerless FIFOs (including linked FIFOs) instead of hanging before checks; preserve regular-file link compatibility and byte limits. This does not impose an I/O deadline on arbitrary filesystems or authenticate linked inputs.
- [x] Share strict UTF-8 decoding across task, policy, benchmark corpus and adjudication input; preserve valid source identity for hashes, reject malformed policy bytes before executing checks, and use the nonblocking bounded reader for benchmark corpora rather than allocating an unchecked growing file with `readFile`.
- [~] Sign evidence manifests and preserve verifier provenance (trusted Git path/version/digest evidence, exact standalone-verifier and Node runtime digests, recorded OS/GitHub runner-image identity, detached Ed25519 report signatures, and GitHub-workload-attested canonical publisher reports delivered; subject-runner attestation and authenticated Ed25519 key ownership remain pending).
- [x] Bound report/key/signature reads during signature processing, and reject malformed UTF-8 report/signature JSON before signing or verifying rather than interpreting replacement-decoded text. Key buffers remain binary-compatible; signer authentication and hostile host races remain outside this improvement.

Exit criterion: a malicious pull request cannot escape the runner, obtain secrets, or approve itself.

## M7 — Calibration and public benchmark

- [x] Build a seeded-defect patch corpus with 12 declarative before/after patches, independently executed file oracles, and a standalone runner.
- [x] Track accepted, rejected, fixed, and overridden findings with immutable, report-hash-bound outcome events and explicit evidence semantics.
- [x] Measure disposition/evidence-backed precision, corpus recall, false blocks per review, override outcomes, and median triage time with hash-bound sample sets.
- [~] Publish a reproducible coding-agent trust leaderboard (bounded hash-bound submission format, comparable-suite validation, deterministic ranking, and standalone compiler delivered; independently collected representative submissions and hosted publication pending).
- [x] Bound leaderboard compilation to 64 MiB aggregate evidence, charging repeated references, and read/reduce reports sequentially instead of retaining all report objects or spawning all file reads; reject malformed UTF-8 manifests/reports and verify mixed-verdict ranking metrics. This is not a process-memory quota or authenticated benchmark result.
- [x] Reject internally contradictory leaderboard reports: type-check ranking inputs, recompute verdicts from structured active findings, reject duplicate check/finding identities, and reconcile boolean causal claims with head/base failure evidence; reject non-regular submission entries rather than omitting candidates. Verify standalone CLI refusal with correctly hash-bound contradictory bytes. Execution/signer authenticity and representative submissions remain pending.
- [x] Require per-task leaderboard review-context comparability: matching policy digests, review scopes, base-reference strings and resolved base commits, with explicit sorted output bindings, no missing-context wildcards, causal-base identity consistency and multi-task/order regressions. Automatic base history selection also requires the resolved commit, excluding legacy missing identities. Authenticated execution remains unverified.
- [x] Add report-bound human missed-finding labels and optional recall aggregation for audited review sets; representative external labels remain pending.
- [x] Enforce bounded nonblocking reads and strict UTF-8 for disposition, missed-label, source-report and calibration evidence; reject non-regular JSON sample entries instead of silently shrinking metrics denominators, and enforce the review-count bound in the missed-label corpus scan.
- [x] Share a 64 MiB aggregate byte budget across outcome events, corpus/missed-label scans and repeated source-report reads, and across calibration outcomes/reports/benchmark/adjudication reads. Clamp reads to remaining allowance, reserve before concurrent I/O, and verify exact/repeated-read boundaries plus whole-run rejection. This is not a process-memory quota.
- [x] Separate declared/file-oracle omission labels from external task-resolution proxies in benchmark/calibration output; prevent proxy outcomes from populating omission recall and emit null rates for absent denominator classes.
- [x] Prepare outcome-blinded omission-review packets and accept hash-bound reviewer assertions with explicit decided/abstained/unreviewed coverage in benchmark/calibration; independent human adjudication remains pending.

Exit criterion: product and model-comparison claims are supported by reproducible measurements.

## Product metrics

- Evidence-backed blocker precision
- Missed-requirement recall
- False blocks per 100 reviews
- Median time to understand and reproduce a finding
- Regressions caught before merge
- Human override rate and subsequent outcomes
