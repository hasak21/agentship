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
7. **Report to consumer:** manifests are hash-bound but not yet signed.

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
| T8 | Malicious repository command executes on maintainer infrastructure | CI report runs only on a disposable GitHub-hosted runner; local runner remains trusted-only | Open on local/self-hosted runners; hosted-runner containment is provider-owned |
| T9 | Forked code reads filesystem, metadata services, or network secrets | CI grants read-only permissions, passes no repository secrets, blanks CLI token variables, and uses a disposable hosted runner | Network and GitHub runtime service credentials remain reachable; do not use secrets or self-hosted runners |
| T10 | Pull request weakens its own AgentShip policy or verifier | CI loads verifier, task extractor, and policy from a separate base-SHA checkout | Mitigated for initial report workflow; organization settings and base compromise remain trusted |
| T11 | Prompt injection persuades a model to approve malicious code | LLM output cannot satisfy deterministic checks | Partially mitigated; inferred findings remain attackable |
| T12 | Report is edited after generation | Input and diff hashes | Open until manifest signing/attestation |
| T13 | Task changes between approval and review | Task digest in report | Detected by consumers only; signatures remain open |
| T14 | Generated test merely encodes implementation | No causal base/head validation yet | Open |
| T15 | In-memory or app-level rate limits fail across replicas | No distributed limiter is claimed | Host/control-plane limiter required |
| T16 | Oversized pull-request input consumes excessive check time | Base-owned changed-file/diff-byte limits block before checks; check and workflow wall-clock timeouts bound duration | CPU, memory, disk, process-count, and network quotas remain open |
| T17 | Contributor suppresses a finding in the same pull request | Fork CI loads exact-match, warning-only suppressions from the trusted base policy and retains suppression evidence | Local working-tree policy is developer-trusted; immutable policy and signed overrides remain open |

## Preconditions for privileged hostile-pull-request enforcement

The secretless artifact-only GitHub-hosted report workflow is a constrained early mode. AgentShip must not advertise self-hosted, privileged, or merge-gating execution until all of these are implemented and tested:

1. Checks run in disposable OS-level isolation with CPU, memory, process, disk, and wall-clock limits.
2. The checkout is mounted read-only or changes are captured in a disposable overlay.
3. Network is denied by default and selectively brokered.
4. No maintainer or provider secret enters the worker.
5. Effective policy is loaded from the trusted base revision or control plane, never solely from the pull request.
6. Forked tasks, source, tests, filenames, and tool output are treated as prompt-injection content.
7. Evidence manifests are signed and identify runner image, tool version, policy hash, base, and head.
8. Generated regression tests are causally validated against base and proposed revisions.

## Review cadence

Update this document when a new entry point, credential source, execution backend, evidence type, or trust claim is introduced. New high-impact open threats take priority over feature work in the development loop.
