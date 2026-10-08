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

Before privileged maintainer-side execution, AgentShip must add aggregate worker budgets, authenticated policy/approval provenance, and privileged evidence attestation. The current hosted report workflow now provisions a digest-pinned bubblewrap package and combines disposable-copy, filesystem, PID, default network isolation, and per-process limits, but remains secretless, neutral, unsigned, and non-gating.

## Evidence manifest

Each report binds together:

- Git head, review scope, changed paths, and a SHA-256 digest of the reviewed diff;
- task and configuration digests;
- exact commands, timing, exit status, and bounded output;
- the canonical Git executable path, bounded version, exact byte length, and SHA-256 used
  to calculate repository evidence;
- the canonical AgentShip entrypoint path, exact byte length, and SHA-256;
- platform, architecture, kernel release, optional bounded OS-release identity/hash, and the
  canonical launching Node executable path, exact byte length, and SHA-256;
- optional bounded GitHub runner and image environment metadata;
- findings derived from that captured evidence;
- the AgentShip schema and tool version.

The JSON report can now be accompanied by a detached Ed25519 signature. The signed
canonical statement binds the exact report byte length and SHA-256 to the trusted public
key's SPKI SHA-256. Verification recomputes all three values and requires an explicitly
supplied public key outside the verifier's trusted working root; the sidecar does not
carry a self-authorizing key. Signing private keys must resolve outside the reviewed
repository and, on POSIX, deny group/other access. See `docs/EVIDENCE_SIGNATURES.md`.

Signatures authenticate possession of a configured key, not a person's identity, unless
the operator separately maps that public-key fingerprint to an owner. The ordinary local
and GitHub report flows remain unsigned unless signing is explicitly configured. Current
CI intentionally sends no signing secret into the pull-request job; a future privileged
attestor must sign only after bounded artifact validation. Key rotation, HSM/KMS support,
revocation, trusted timestamps, transparency logs, and authenticated runner/workload
attestations remain open provenance work.

## Verifier tool resolution

Every CLI review canonicalizes its actual `process.argv[1]` entrypoint, bounds it to 32
MiB, reads it through one open file handle, rejects concurrent size/mtime/inode changes,
and records its byte length and SHA-256. In standalone and official CI operation this is
the exact self-contained `agentship.cjs` bundle. The privileged publisher requires
well-formed bounded verifier provenance before accepting an artifact and shows the digest
in its neutral Check Run summary. A detached report signature, when separately enabled,
also covers these fields because it signs the exact JSON bytes.

In `npm run review` source mode, the entrypoint is `src/cli/index.ts`; its digest does not
cover imported source files, installed dependencies, or loader behavior. Every CLI review
separately hashes the exact launching Node executable, records bounded host/OS identity,
and includes GitHub runner/image environment metadata when available. The privileged
publisher requires the official report to claim GitHub-hosted Linux X64 execution and
validates all those fields structurally. These fields identify bytes and claims rather than
authenticating them. Trust still comes from how the operator obtained the runtime/bundle
and, for signed evidence, how the public key was established. Signed runner-image,
kernel/workload, dependency, and build-reproducibility attestations remain open.

Repository evidence never resolves `git` through an unfiltered inherited `PATH`.
AgentShip prefers canonical host-owned system locations on Linux, macOS, and Windows;
fallback search accepts only absolute directories outside the reviewed checkout and
rejects every `node_modules/.bin` segment. Symlink targets are canonicalized and checked
again. If no such executable exists, review fails closed. The selected canonical path and
the bounded `git --version` result are retained in evidence. AgentShip hashes the bounded
binary through a stable file handle before and after version execution, records its byte
length and SHA-256, and repeats provenance collection after checks; a mismatch fails the
review without producing misleading evidence.

This protects the common `npm run review` case where npm injects repository package bins
ahead of system paths. It does not authenticate the host operating system or protect
against a privileged administrator substituting and restoring a system Git binary between
observations. OS-package signatures, reproducible Git builds, shared-library identity, and
signed runner/workload provenance remain unfinished evidence-attestation work.

## Public provider boundary

Next.js route handlers are public endpoints. They may select a supported provider and model, but they cannot supply credentials or provider base URLs. Network destinations and server credentials remain deployment-owned configuration.

The lower-level provider client also refuses to inherit an environment credential when code supplies an explicit base URL without an explicit credential. This is defense in depth against future route regressions.

## Local check environment

Local checks receive a minimal cross-platform environment allowlist. A repository may request additional variable names for a check, but captured evidence records only those names. Values whose names indicate credentials, tokens, cookies, passwords, secrets, or authenticated proxies are redacted from stdout and stderr.

Timeouts terminate the spawned process tree rather than only the shell parent. Checks with a `resources` policy execute on Linux through `/usr/bin/prlimit` with exact CPU-time, virtual-address-space, file-size, and open-file limits; configuration fails closed when that backend is unavailable. Children inherit these limits, but consumption is not aggregated across the process tree. This is a reliability boundary, not hostile-code isolation: checks still execute directly on the host and retain its filesystem and network view.

For direct checks, the `network` field remains a declared capability recorded in evidence
rather than an enforced boundary. For checks with `isolation: bubblewrap`, it is enforced: absent or
`denied` creates a fresh network namespace, while `allowed` deliberately shares the host
network namespace and mounts only resolver/certificate configuration needed by clients.
Non-isolated checks retain the older declaration-only behavior. The report distinguishes
the backend, disposable workspace, filesystem profile, and effective network mode so a
consumer cannot confuse a direct check with an isolated one.

The bubblewrap worker makes a bounded copy of Git-tracked and non-ignored untracked
repository content, omitting `.git`, `.agentship`, ignored local secrets, and
`node_modules`; a host-installed dependency tree is mounted read-only.
The worker receives only `/usr`, essential library paths, the active Node distribution,
a private `/proc`, minimal `/dev`, and fresh temporary/home directories. It does not see
the host home, `/etc`, or repository writes made inside the disposable copy. An explicitly
network-allowed worker additionally receives read-only TLS and resolver files. Copy setup
is bounded to 200,000 entries and 2 GiB and fails closed on special files or unavailable
Linux user namespaces. This boundary does not prevent kernel exploits, side channels,
resource use outside current per-process limits, or malicious behavior in an explicitly
mounted runtime/dependency tree.

Isolated checks also drop environment names shaped like credentials, tokens, cookies,
passwords, or secrets even when requested by policy. Proxy variables are retained only
for credential-free origin URLs, while `NO_PROXY` remains routing data. This is defense
in depth, not semantic secret detection: an operator can still place a secret under an
innocuous custom name, so hostile-check policies must never request unknown sensitive
values.

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

Human-readable Markdown is a separate display boundary. Task prose, paths, check labels,
commands, finding titles, and operator-supplied reasons are normalized and encoded before
they enter fixed report prose, tables, or code markup. This prevents those values from
creating apparent AgentShip headings, columns, links, or raw HTML. The underlying JSON
and SARIF preserve structured evidence; other consumers remain responsible for encoding
it for their own output context.

A task containing the exact `<!-- agentship: strict-change-coverage -->` directive turns unattributed files into a warning-level finding. The task document itself is excluded because it is review input rather than implementation output. Only explicit path mappings satisfy strict attribution; inferred roles cannot hide an unattributed file. The directive is task-owned and warning-only, so it is not an immutable repository policy and is not sufficient for hostile pull-request enforcement.

A requirement prefixed with `[confirm]` blocks gate-mode review until its stable requirement ID is supplied through `--confirm`. The report records whether confirmation was required or supplied. This is an explicit local operator assertion bound to the task and diff hashes; it is not authenticated identity, a signature, or attested approval. AgentShip does not infer ambiguity from unrestricted prose.

Requirements with observed file or symbol evidence under a configured `protectedPaths` entry whose `requireManualApproval` flag is true also require `--confirm`. The report records `protected_path` as the basis. Version 1 accepts only exact repository-relative paths and trailing `/**` directory patterns. This makes high-impact classification deterministic, but the local assertion is still unauthenticated and the repository-owned policy can be changed in the same patch. Immutable policy loading and signed approvals remain policy-gate work.

Independently of task mapping, every observed changed file is matched against repository `protectedPaths`. A matching entry with `requireManualApproval: true` produces a blocker until the operator supplies the exact configured pattern through repeatable `--approve-path` arguments. Unknown patterns and duplicate policy identities are rejected. JSON and Markdown evidence retain the pattern, matching files, approval state, configuration hash, and reviewed diff hash. This closes the task-annotation bypass but remains a local unauthenticated assertion; explicit mapped requirements retain their separate `--confirm` decision.

Metrics from the explicit-evidence fixture corpus describe only deterministic annotation handling. They must not be presented as semantic missed-requirement recall; that requires a separate real or seeded defect corpus with independently known outcomes.

The initial seeded omission corpus is a deliberately small, synthetic calibration set with independently labeled outcomes. Its eight cases currently produce 0.80 precision, 0.80 recall, and one-third false-positive rate for omission detection. These values expose current blind spots; they are regression baselines, not publishable product-performance claims. In particular, behavior-only semantic omissions remain undetected and stale explicit annotations can create false positives. A representative external corpus is still required.

The primary executable corpus contains 12 declarative before/after patch cases. AgentShip applies each patch in memory, derives changed paths and a line-level unified diff, and executes bounded file-existence/content oracles to determine the outcome independently of the detector. It never executes corpus-provided shell commands. The current executable baseline is 0.667 precision, 0.667 recall, and one-third false-positive rate. Its false negatives include behavior-only security and documentation-content omissions; false positives include stale path annotations and unconventional test layouts. The corpus is still synthetic and small, so these metrics remain engineering baselines rather than publishable real-world accuracy.

The `benchmark --fixtures` command validates corpus paths, size bounds, schema, and unique case identifiers, then emits the source SHA-256, aggregate confusion-matrix metrics, every case result, and executable oracle outcomes where present. The standalone executable requires an explicit corpus path; it does not embed a favorable corpus, execute corpus code, or call a model. Corpus provenance and representativeness remain the benchmark publisher's responsibility.

## CI report boundary

The subject GitHub workflow uses the unprivileged `pull_request` event with `contents: read`, no repository secrets, blank CLI token variables, a GitHub-hosted disposable runner, and full-commit-SHA-pinned official actions. It checks out the base revision and pull-request subject separately. The AgentShip executable, task extractor, and `.agentship.ci.yml` policy are built or loaded from the trusted base checkout; pull-request changes cannot replace them for that run. The PR title/body is passed as data through the GitHub event file, never interpolated into a shell program. JSON, Markdown, and SARIF reports are uploaded as artifacts, and the Markdown is copied into the workflow job summary.

A separate default-branch `workflow_run` publisher holds `checks: write`. It checks out
only trusted publisher code, downloads the named artifact from the exact triggering run,
and treats every artifact byte as untrusted data. The parser bounds both event and report,
requires one event-associated pull request, verifies repository and base bindings, and
selects the Check Run head exclusively from the trusted workflow event. The result is
always `neutral`, including for a BLOCK report, so it cannot serve as a policy gate. The
publisher does not execute artifact contents or write comments, labels, source, releases,
deployments, code-scanning results, or merge status.

Repository policy treats `.github/workflows/**` as a protected path requiring explicit
local approval. Operators must not configure the neutral publisher Check Run as a
required branch-protection check; doing so would confuse report delivery with approval.

The subject's configured checks execute hostile repository code inside disposable bubblewrap workspaces on a GitHub-hosted runner. A trusted-base installer fetches one fixed Ubuntu Noble amd64 package, checks its published SHA-256 before installation, rejects setuid/wrong-version binaries, and smoke-tests namespace creation. Every check gets a fresh network namespace. The Next build uses pinned Geist v1.7.2 variable assets with fixed hashes and the SIL Open Font License stored in the repository, removing its former Google Fonts fetch. This remains suitable only for secretless, read-only reporting on GitHub-hosted disposable runners. It is not safe for self-hosted runners, privileged subject triggers, subject write tokens, secrets, or merge gating. GitHub repository settings can also opt into write tokens or secrets for fork workflows; operators must leave those options disabled. The unsigned artifact may be attacker-influenced despite the trusted verifier, which is why the privileged publisher emits only a bounded neutral summary. Live fork-PR validation remains required before the workflow is marked fully delivered.

Base-owned `whenChanged` patterns select checks using only exact repository paths and trailing `/**` directory patterns. A non-applicable check is recorded as `skipped`, never as passing; a task that explicitly requires that check remains unsatisfied. Base-owned changed-file and diff-byte limits produce a blocker and skip repository commands before an oversized review executes. Per-check and workflow wall-clock timeouts are enforced. The official Linux policy additionally applies per-process CPU-time, file-size, and descriptor limits through `prlimit`, and bubblewrap supplies a bounded disposable copy plus PID/filesystem/network namespaces. A configurable address-space bound exists but is omitted for official Node checks because it is not a reliable resident-memory bound and breaks runtimes that reserve large virtual ranges. Aggregate process-tree accounting, reliable memory, disk-capacity, process-count, host-kernel isolation, and dependency installation with network access outside the worker remain residual risks.

Repository-owned suppressions match an exact finding ID and warning kind. Each entry has a stable suppression ID, owner, reason, and calendar-date expiry. An active suppression is attached to—not removed from—the finding, is represented as an accepted external SARIF suppression, and removes only that warning's verdict impact. Expired entries are ignored. The schema rejects blocker kinds, duplicate identities, duplicate targets, invalid dates, and unbounded ownership/reason text.

Repository-owned `policy.blockOn` entries promote named warning finding kinds to blockers. The schema accepts only implemented finding kinds and rejects duplicates, and the effective configured list is captured in JSON and Markdown evidence. Promotion happens before suppression, so a configured blocker cannot be suppressed through the warning-exception mechanism. Findings that protect evidence integrity—required check failure or timeout, repository mutation, exceeded review budgets, and missing required confirmation—remain blockers independently of this list. Report mode records a `BLOCK` verdict without changing the process exit code; gate mode enforces the verdict.

In the fork workflow, suppressions come from the separately checked-out base policy, so a pull request cannot suppress itself. In local working-tree mode, `.agentship.yml` may change in the same diff and remains developer-trusted; suppression there is not immutable approval, authenticated identity, or an override attestation. Policy immutability and signed actor-bound overrides remain M5 work.

Overrides are supplied as bounded JSON records after an initial unmodified review. Each record names a stable ID, claimed actor, bounded reason, calendar-date expiry, exact finding identities, and the path and SHA-256 of the source report. AgentShip verifies the source bytes and requires the source report's head, diff, configuration, and optional task hashes to match the current review. Targets must be present in both reports. Accepted overrides remain attached to findings and appear as external accepted suppressions in SARIF; they do not delete evidence. Repository mutation, review-budget, missing-confirmation, and protected-path-approval findings cannot be overridden. The actor field is still a claim—not authenticated identity or a signature—and CI must load override records from a trusted revision before they can safely affect a gate.

A baseline is an optional prior AgentShip JSON report supplied through `--baseline`. AgentShip reads it as bounded data with a 5 MiB file limit, a 10,000-finding limit, required schema/run/commit metadata, bounded identity fields, and duplicate rejection. It binds results to the baseline SHA-256 and compares exact finding ID/kind pairs. The comparison labels findings new, existing, or resolved but does not suppress findings or affect the current verdict. Baseline selection, provenance, and retention are not yet automated or attested.

Opt-in local history automates compatible baseline selection and retention. AgentShip accepts only a repository-child history directory, bounds it to 1,000 entries, rejects malformed or oversized reports, and selects the newest candidate with identical configuration SHA-256, task SHA-256, review scope, and base reference. It writes JSON, Markdown, and SARIF only after checks and repository-stability capture complete, so ignored history output is not part of the reviewed diff. CI restores only from a PR-scoped cache namespace under explicit read-only access. The separate publisher validates workflow, repository, PR/base, report scope, hash fields, and bounds before canonicalizing one report and saving it with explicit write-only access. Cache misses and incompatible history are non-fatal, and comparison remains unable to alter verdicts. This improves writer provenance but is not signing: cache bytes remain unsigned and namespace isolation also depends on repository workflow governance.

Finding outcome events bind an exact finding identity to the SHA-256 and execution context of its source report. Accepted and rejected events are explicitly human dispositions. Fixed events additionally require a compatible later report in which that identity is absent, while overridden events require the source finding to retain validated override evidence. Files are bounded and exclusively created inside the repository, but actor strings remain unauthenticated and local event files are unsigned. Metrics derived from them inherit that provenance limit and should use trusted artifact storage.

Calibration recomputes metrics from three bounded inputs: a complete review-report denominator, outcome events whose source and resolution bytes must occur in that denominator, and a freshly executed intent benchmark. Exact source-report and finding identities group lifecycle events; conflicting confirmed/rejected dispositions fail closed. Aggregate directory hashes, corpus hash, formulas, and sample sizes make the result reproducible. This does not authenticate actors, prove that the supplied report directory is complete, or make a synthetic corpus representative. Trusted append-only collection and representative external corpora remain operator and M3 responsibilities.

The fork workflow loads protected-path policy from the trusted base checkout, so pull-request changes cannot weaken the effective policy used for that run. Local working-tree reviews still trust the mutable checkout policy. Authenticated approvals and signed override records remain later provenance work.

The trusted-policy boundary is covered by an executable regression: a subject modifies its own `.agentship.yml` from gate mode to permissive report mode, removes protected paths, and substitutes a passing check, while AgentShip loads an external base-owned configuration. The resulting report retains gate mode and emits both the trusted required-check failure and protected-path blocker. The official workflow separately asserts that it never passes subject-controlled `--approve-path` or `--override` inputs. This proves precedence for the checked-in workflow structure; GitHub settings and live fork behavior remain external deployment assumptions.

## Repository-state integrity

AgentShip captures the Git head and diff digest before and after executing checks. Any difference is a blocker because command results would otherwise describe a different repository state from the one named by the report. This detects mutation; isolated read-only execution remains a later maintainer-mode control.
