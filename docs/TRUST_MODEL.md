# AgentShip Trust Model

AgentShip verifies agent-written changes; it does not trust an agent's account of what it changed or executed.

## Evidence hierarchy

1. **Claimed** — supplied by an agent, contributor, or model. Never sufficient to pass a check.
2. **Inferred** — produced by static analysis or an LLM. Useful for investigation, but non-blocking by default.
3. **Observed** — captured directly by AgentShip from Git, a command, or a tool response.
4. **Reproduced** — an observed failure with an executable reproduction, ideally failing before a repair and passing afterward.
5. **Attested** — an explicit human decision bound to a specific report and change hash.

Only observed, reproduced, or explicitly attested evidence may satisfy a required check. LLM output must never be represented as proof that a command ran.

## Bootstrap boundary

The first local runner executes commands from the repository's trusted `.agentship.yml`. It is intended for a developer's own checkout. It is not yet safe for hostile pull requests because repository commands execute on the host.

Before maintainer-side execution, AgentShip must add process isolation, network denial by default, resource budgets, secret separation, immutable policy loading, and signed evidence manifests.

## Evidence manifest

Each report binds together:

- Git head, review scope, changed paths, and a SHA-256 digest of the reviewed diff;
- task and configuration digests;
- exact commands, timing, exit status, and bounded output;
- findings derived from that captured evidence;
- the AgentShip schema and tool version.

The current manifest is tamper-evident through hashes but is not cryptographically signed.

## Public provider boundary

Next.js route handlers are public endpoints. They may select a supported provider and model, but they cannot supply credentials or provider base URLs. Network destinations and server credentials remain deployment-owned configuration.

The lower-level provider client also refuses to inherit an environment credential when code supplies an explicit base URL without an explicit credential. This is defense in depth against future route regressions.

## Local check environment

Local checks receive a minimal cross-platform environment allowlist. A repository may request additional variable names for a check, but captured evidence records only those names. Values whose names indicate credentials, tokens, cookies, passwords, secrets, or authenticated proxies are redacted from stdout and stderr.

Timeouts terminate the spawned process tree rather than only the shell parent. This is a reliability boundary, not hostile-code isolation: trusted local checks still execute directly on the host.

The `network` field in version 1 policy is a declared capability recorded in evidence; it is not yet enforced. Network denial requires the isolated runner planned for adversarial maintainer mode.

## Public API boundary

AgentShip binds its web server to localhost by default. Audit, research, and MCP requests have explicit body limits and object validation. Deployments that expose these endpoints should set `AGENTSHIP_API_TOKEN`; expensive POST requests then require the corresponding bearer token.

This application-level token is a first boundary, not a complete multi-tenant authorization or distributed rate-limiting system. Internet-facing deployments still require TLS, host-level rate limiting, and secret management.

Outbound provider calls use aborting deadlines. The default provider deadline is shorter than the multi-agent supervisor deadline, preventing a timed-out node from leaving an indefinitely running fetch behind. This bounds individual requests but does not replace total-run cost budgets.

## Task intent input

Version 1 extracts only numbered items written under a Markdown `Requirements` heading. Each receives a stable identifier and source line in the evidence manifest. These items are explicit task input, not proof that the implementation satisfies them. Inferred or ambiguous requirements remain a later, separately labeled layer.

Paths explicitly annotated as ``change:path`` inside requirements are mapped to the observed changed-file set. Every annotation in a requirement must match at least one changed file; partial coverage remains `missing`, and the unmatched references are recorded. Ordinary code-formatted paths remain context and are not treated as mandates. This mapping proves only that named paths changed, not that behavior is correct or the requirement is satisfied. Requirements without change annotations remain `unmapped`; AgentShip does not guess.

Checks explicitly annotated as ``check:name`` are mapped after execution to the captured status of the identically named configured check. Every check annotation must resolve to a passing check; failed, timed-out, and unconfigured names are recorded as unsatisfied evidence. A passing check proves only that the recorded command exited successfully for the reviewed diff. It does not prove that the check exercises the requirement or that the behavior is correct.

Symbols explicitly annotated as ``symbol:path#identifier`` are matched only against added or deleted lines in the captured unified diff for that exact path. The report distinguishes an unchanged file, a changed file without the symbol token, and changed content unavailable to the diff mapper. Binary and untracked working-tree content may be unavailable. A match proves only that the identifier token appeared on a changed line; it does not prove which declaration it names, that its behavior changed correctly, or that all changes to the symbol were captured.

For requirements without an equivalent explicit path annotation, AgentShip conservatively infers test or documentation file roles from imperative phrases such as “add regression tests” and “update the operator guide.” It checks only whether a changed path has the inferred role and labels the result `inferred_observed` or `inferred_missing`. Common negations are suppressed. These heuristic results are warning-level inferred evidence: a matching file does not prove adequate coverage, and unmatched wording or unconventional repository layouts can cause misses or false positives.

The report also lists changed files not matched by any explicit change annotation. These files are **unattributed**, not proven unrelated. This reverse-coverage view is evidence for human review and does not produce a finding by itself.

A task containing the exact `<!-- agentship: strict-change-coverage -->` directive turns unattributed files into a warning-level finding. The task document itself is excluded because it is review input rather than implementation output. Only explicit path mappings satisfy strict attribution; inferred roles cannot hide an unattributed file. The directive is task-owned and warning-only, so it is not an immutable repository policy and is not sufficient for hostile pull-request enforcement.

A requirement prefixed with `[confirm]` blocks gate-mode review until its stable requirement ID is supplied through `--confirm`. The report records whether confirmation was required or supplied. This is an explicit local operator assertion bound to the task and diff hashes; it is not authenticated identity, a signature, or attested approval. AgentShip does not infer ambiguity from unrestricted prose.

Requirements with observed file or symbol evidence under a configured `protectedPaths` entry whose `requireManualApproval` flag is true also require `--confirm`. The report records `protected_path` as the basis. Version 1 accepts only exact repository-relative paths and trailing `/**` directory patterns. This makes high-impact classification deterministic, but the local assertion is still unauthenticated and the repository-owned policy can be changed in the same patch. Immutable policy loading and signed approvals remain policy-gate work.

Independently of task mapping, every observed changed file is matched against repository `protectedPaths`. A matching entry with `requireManualApproval: true` produces a blocker until the operator supplies the exact configured pattern through repeatable `--approve-path` arguments. Unknown patterns and duplicate policy identities are rejected. JSON and Markdown evidence retain the pattern, matching files, approval state, configuration hash, and reviewed diff hash. This closes the task-annotation bypass but remains a local unauthenticated assertion; explicit mapped requirements retain their separate `--confirm` decision.

Metrics from the explicit-evidence fixture corpus describe only deterministic annotation handling. They must not be presented as semantic missed-requirement recall; that requires a separate real or seeded defect corpus with independently known outcomes.

The initial seeded omission corpus is a deliberately small, synthetic calibration set with independently labeled outcomes. Its eight cases currently produce 0.80 precision, 0.80 recall, and one-third false-positive rate for omission detection. These values expose current blind spots; they are regression baselines, not publishable product-performance claims. In particular, behavior-only semantic omissions remain undetected and stale explicit annotations can create false positives. A representative external corpus is still required.

The primary executable corpus contains 12 declarative before/after patch cases. AgentShip applies each patch in memory, derives changed paths and a line-level unified diff, and executes bounded file-existence/content oracles to determine the outcome independently of the detector. It never executes corpus-provided shell commands. The current executable baseline is 0.667 precision, 0.667 recall, and one-third false-positive rate. Its false negatives include behavior-only security and documentation-content omissions; false positives include stale path annotations and unconventional test layouts. The corpus is still synthetic and small, so these metrics remain engineering baselines rather than publishable real-world accuracy.

The `benchmark --fixtures` command validates corpus paths, size bounds, schema, and unique case identifiers, then emits the source SHA-256, aggregate confusion-matrix metrics, every case result, and executable oracle outcomes where present. The standalone executable requires an explicit corpus path; it does not embed a favorable corpus, execute corpus code, or call a model. Corpus provenance and representativeness remain the benchmark publisher's responsibility.

## CI report boundary

The initial GitHub workflow uses the unprivileged `pull_request` event with `contents: read`, no repository secrets, blank CLI token variables, a GitHub-hosted disposable runner, and full-commit-SHA-pinned official actions. It checks out the base revision and pull-request subject separately. The AgentShip executable, task extractor, and `.agentship.yml` policy are built or loaded from the trusted base checkout; pull-request changes cannot replace them for that run. The PR title/body is passed as data through the GitHub event file, never interpolated into a shell program. JSON, Markdown, and SARIF reports are uploaded as artifacts, and the Markdown is copied into the workflow job summary. The workflow does not write a Check Run, comment, label, code-scanning result, or merge status.

The subject's configured checks still execute hostile repository code with network access inside the hosted runner. This mode is suitable only for secretless, read-only reporting on GitHub-hosted disposable runners. It is not safe for self-hosted runners, privileged triggers, write tokens, secrets, cloud metadata access, or merge gating. GitHub repository settings can also opt into write tokens or secrets for fork workflows; operators must leave those options disabled. Live fork-PR validation remains required before the workflow is marked fully delivered.

Base-owned `whenChanged` patterns select checks using only exact repository paths and trailing `/**` directory patterns. A non-applicable check is recorded as `skipped`, never as passing; a task that explicitly requires that check remains unsatisfied. Base-owned changed-file and diff-byte limits produce a blocker and skip repository commands before an oversized review executes. Per-check and workflow wall-clock timeouts are also enforced, but there are no CPU, memory, disk, process-count, or network quotas yet.

Repository-owned suppressions match an exact finding ID and warning kind. Each entry has a stable suppression ID, owner, reason, and calendar-date expiry. An active suppression is attached to—not removed from—the finding, is represented as an accepted external SARIF suppression, and removes only that warning's verdict impact. Expired entries are ignored. The schema rejects blocker kinds, duplicate identities, duplicate targets, invalid dates, and unbounded ownership/reason text.

Repository-owned `policy.blockOn` entries promote named warning finding kinds to blockers. The schema accepts only implemented finding kinds and rejects duplicates, and the effective configured list is captured in JSON and Markdown evidence. Promotion happens before suppression, so a configured blocker cannot be suppressed through the warning-exception mechanism. Findings that protect evidence integrity—required check failure or timeout, repository mutation, exceeded review budgets, and missing required confirmation—remain blockers independently of this list. Report mode records a `BLOCK` verdict without changing the process exit code; gate mode enforces the verdict.

In the fork workflow, suppressions come from the separately checked-out base policy, so a pull request cannot suppress itself. In local working-tree mode, `.agentship.yml` may change in the same diff and remains developer-trusted; suppression there is not immutable approval, authenticated identity, or an override attestation. Policy immutability and signed actor-bound overrides remain M5 work.

Overrides are supplied as bounded JSON records after an initial unmodified review. Each record names a stable ID, claimed actor, bounded reason, calendar-date expiry, exact finding identities, and the path and SHA-256 of the source report. AgentShip verifies the source bytes and requires the source report's head, diff, configuration, and optional task hashes to match the current review. Targets must be present in both reports. Accepted overrides remain attached to findings and appear as external accepted suppressions in SARIF; they do not delete evidence. Repository mutation, review-budget, missing-confirmation, and protected-path-approval findings cannot be overridden. The actor field is still a claim—not authenticated identity or a signature—and CI must load override records from a trusted revision before they can safely affect a gate.

A baseline is an optional prior AgentShip JSON report supplied through `--baseline`. AgentShip reads it as bounded data with a 5 MiB file limit, a 10,000-finding limit, required schema/run/commit metadata, bounded identity fields, and duplicate rejection. It binds results to the baseline SHA-256 and compares exact finding ID/kind pairs. The comparison labels findings new, existing, or resolved but does not suppress findings or affect the current verdict. Baseline selection, provenance, and retention are not yet automated or attested.

Opt-in local history automates compatible baseline selection and retention. AgentShip accepts only a repository-child history directory, bounds it to 1,000 entries, rejects malformed or oversized reports, and selects the newest candidate with identical configuration SHA-256, task SHA-256, review scope, and base reference. It writes JSON, Markdown, and SARIF only after checks and repository-stability capture complete, so ignored history output is not part of the reviewed diff. Compatibility prevents cross-task identity collisions but is not provenance: CI must restore history from a trusted source, and reports remain unsigned.

The fork workflow loads protected-path policy from the trusted base checkout, so pull-request changes cannot weaken the effective policy used for that run. Local working-tree reviews still trust the mutable checkout policy. Authenticated approvals and signed override records remain later provenance work.

The trusted-policy boundary is covered by an executable regression: a subject modifies its own `.agentship.yml` from gate mode to permissive report mode, removes protected paths, and substitutes a passing check, while AgentShip loads an external base-owned configuration. The resulting report retains gate mode and emits both the trusted required-check failure and protected-path blocker. The official workflow separately asserts that it never passes subject-controlled `--approve-path` or `--override` inputs. This proves precedence for the checked-in workflow structure; GitHub settings and live fork behavior remain external deployment assumptions.

## Repository-state integrity

AgentShip captures the Git head and diff digest before and after executing checks. Any difference is a blocker because command results would otherwise describe a different repository state from the one named by the report. This detects mutation; isolated read-only execution remains a later maintainer-mode control.
