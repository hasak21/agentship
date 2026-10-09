# AgentShip Threat Model

## Scope

This model covers the local review CLI, public Next.js endpoints, provider clients, evidence artifacts, and the planned CI/maintainer runner. It distinguishes the current trusted-local mode from future execution of untrusted pull requests.

## Protected assets

- Source code and uncommitted developer work
- Provider credentials, repository tokens, and local machine secrets
- Integrity of verification reports and policy
- CI compute and model spending
- Availability of the developer machine and hosted service
- Contributor and approver identity

## Trust boundaries

1. **Developer to local policy:** `.agentship.yml` is trusted in local mode.
2. **Repository to check process:** commands execute on the host today; repository code is therefore trusted.
3. **HTTP client to route handler:** all request fields are untrusted.
4. **Agent/model output to verifier:** model output is claimed or inferred, never executed evidence.
5. **Verifier to provider:** destinations and credentials are deployment-owned.
6. **Fork to maintainer infrastructure:** the GitHub-hosted report workflow treats fork contents, tests, and task text as hostile; privileged or self-hosted execution remains unsupported.
7. **Report to consumer:** local manifests are hash-bound and optionally Ed25519-signed; the official publisher attests canonical CI report bytes with GitHub workload identity.
8. **Publisher to CI history:** only the bounded trusted publisher writes the AgentShip cache namespace after attestation; pull-request jobs receive read-only cache access but do not verify the attestation on restore.

## Adversaries

- A malicious contributor submitting executable repository changes
- A prompt-injection payload embedded in code, tests, issues, or documentation
- An unauthenticated network client attempting cost or resource exhaustion
- A compromised or malicious model provider
- A well-intentioned agent that overstates completion or fabricates test results
- A check that accidentally mutates files or leaks environment values

## Threat register

| ID | Threat | Current control | Residual status |
| --- | --- | --- | --- |
| T1 | Caller-controlled provider URL exfiltrates server credentials | Public routes reject URLs/keys; explicit URLs cannot inherit environment keys | Mitigated for public routes |
| T2 | Oversized or malformed requests exhaust route resources | Per-route byte limits and JSON object validation | Partially mitigated; host limits still required |
| T3 | Unauthenticated callers spend provider quota | Localhost default; optional bearer token | Open if operator exposes an unprotected server |
| T4 | Stalled provider calls continue after supervisor timeout | Aborting provider deadlines | Mitigated per request; total-run budgets remain open |
| T5 | Check prints allowed credentials into captured output | Minimal environment and sensitive-value redaction | Partially mitigated; host files remain readable |
| T6 | Timed-out check leaves child processes alive | POSIX process-group and Windows process-tree termination | Mitigated for normal processes |
| T7 | Check mutates the reviewed tree after its digest is captured | Before/after head and diff comparison blocks the report | Detected, not prevented |
| T8 | Malicious repository command executes on maintainer infrastructure | Official Linux checks run in bubblewrap PID/filesystem/network namespaces over bounded disposable copies, composed with `prlimit`, on a disposable GitHub-hosted runner | Shared-kernel escape, dependency installation before sandboxing, and non-isolated local/self-hosted execution remain open |
| T9 | Forked code reads filesystem, metadata services, or network secrets | Bubblewrap exposes a minimal read-only runtime, fresh home/tmp, name-based credential environment filtering, and fresh network namespaces for every official check; on GitHub-hosted runners trusted `sudo unshare` creates only the empty denied-network namespace, then trusted `setpriv` restores the runner identity and clears groups and every capability set before bubblewrap or repository code; pinned local fonts keep the build offline; CI grants read-only permissions, no repository secrets, blank CLI token variables, and a disposable runner | Dependency installation precedes isolation with network access; the trusted base workflow and host's passwordless-sudo policy are part of the boundary; innocently named secrets, kernel, and side-channel risks remain |
| T10 | Pull request weakens its own AgentShip policy or verifier | CI loads verifier, task extractor, and policy from a separate base-SHA checkout | Mitigated for initial report workflow; organization settings and base compromise remain trusted |
| T11 | Prompt injection persuades a model to approve malicious code | LLM output cannot satisfy deterministic checks | Partially mitigated; inferred findings remain attackable |
| T12 | Report is edited after generation | Optional detached Ed25519 statements bind local report bytes to a trusted-key fingerprint; the official publisher uses GitHub Sigstore attestation for exact post-validation canonical CI bytes | Incoming subject artifacts and unsigned local flows remain open; attestation proves publisher identity and digest, not report truth; key ownership, revocation, trusted time, and signer isolation remain operator responsibilities |
| T13 | Task changes between approval and review | Task digest in report; optional detached signature covers the exact report bytes | Unsigned consumers must independently retain and compare the digest |
| T14 | Generated test merely encodes implementation | Opt-in causal checks overlay explicit changed test/fixture paths onto the merge base and require the same isolated command to fail normally on base after passing on head | Test-path classification is trusted policy; semantic correctness, dependency causality, and specification completeness remain open |
| T15 | In-memory or app-level rate limits fail across replicas | No distributed limiter is claimed | Host/control-plane limiter required |
| T16 | Oversized pull-request input consumes excessive check resources | Base-owned input and bubblewrap-copy entry/byte limits block early; a cumulative check wall-clock deadline clamps active work and stops later checks; Linux per-process CPU/file-size/file-descriptor limits bound individual processes in official CI | Reliable aggregate CPU/memory/process-tree, disk-capacity, and process-count quotas remain open |
| T17 | Contributor suppresses a finding in the same pull request | Fork CI loads exact-match, warning-only suppressions from the trusted base policy and retains suppression evidence | Local working-tree policy is developer-trusted; immutable policy and signed overrides remain open |
| T18 | Malformed or misleading baseline hides a regression | Baselines are size/count/schema bounded, hash-bound, exact-match only, and cannot affect verdicts; CI additionally requires compatible task/policy/scope/base context | Unsigned provenance remains visible but cannot weaken the verdict |
| T19 | Fork or low-trust workflow poisons or redirects shared CI history | PR job declares cache read-only; only the non-executing publisher canonicalizes and attests a context-validated report before saving under a unique PR/run key; verifier rejects symlinked history directories | Cache readers do not retrieve or verify the attestation, background-process races require worker isolation, and another repository workflow could collide with the namespace; workflow governance remains trusted |
| T20 | Hostile task text, paths, or policy labels forge headings, tables, links, or HTML in the human-readable report | Markdown output normalizes control characters, escapes prose metacharacters/HTML, and renders code-like values as HTML-encoded code | JSON/SARIF consumers and future renderers must continue treating all display fields as data |
| T21 | A repository package or changing host binary substitutes `git` before AgentShip captures the head or diff | Git resolves from canonical system locations or sanitized absolute fallback paths; repository and all `node_modules/.bin` paths are rejected; stable byte length/SHA-256 and bounded version are collected before and after checks | A privileged administrator could substitute and restore bytes between observations; OS-package signatures, shared libraries, reproducible builds, and signed runner/workload provenance remain open |
| T22 | A report cannot identify which verifier/runtime environment produced it | Reports bind canonical AgentShip and Node executable byte lengths/SHA-256 plus bounded platform, kernel, OS-release, and optional GitHub image metadata; official publication requires structurally valid GitHub-hosted Linux X64 claims and attests the resulting canonical report with the publisher workflow identity | The publisher attestation does not authenticate subject-runner or environment claims; source-entry hashes omit imports/dependencies; signed subject-runner/workload and reproducible-build attestations remain open |

## Preconditions for privileged hostile-pull-request enforcement

The secretless artifact-only GitHub-hosted report workflow is a constrained early mode. AgentShip must not advertise self-hosted, privileged, or merge-gating execution until all of these are implemented and tested:

1. Checks run in disposable OS-level isolation with CPU, memory, process, disk, and wall-clock limits.
2. The checkout is mounted read-only or changes are captured in a disposable overlay.
3. Network is denied by default and selectively brokered.
4. No maintainer or provider secret enters the worker.
5. Effective policy is loaded from the trusted base revision or control plane, never solely from the pull request.
6. Forked tasks, source, tests, filenames, and tool output are treated as prompt-injection content.
7. Evidence manifests are signed and identify runner image, tool version, policy hash, base, and head.
8. Generated regression tests use causal mode with narrowly reviewed test overlays; semantic adequacy still requires review.

## Review cadence

Update this document when a new entry point, credential source, execution backend, evidence type, or trust claim is introduced. New high-impact open threats take priority over feature work in the development loop.
