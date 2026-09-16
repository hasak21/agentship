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
6. **Fork to maintainer infrastructure:** not yet supported safely; fork contents, tests, tasks, and configuration are hostile.
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
| T8 | Malicious repository command executes on maintainer host | None in version 1 local runner | Open — do not run hostile PRs |
| T9 | Forked code reads filesystem, metadata services, or network secrets | Environment allowlist only | Open until isolated runner |
| T10 | Pull request weakens its own AgentShip policy | None | Open until trusted out-of-tree policy loading |
| T11 | Prompt injection persuades a model to approve malicious code | LLM output cannot satisfy deterministic checks | Partially mitigated; inferred findings remain attackable |
| T12 | Report is edited after generation | Input and diff hashes | Open until manifest signing/attestation |
| T13 | Task changes between approval and review | Task digest in report | Detected by consumers only; signatures remain open |
| T14 | Generated test merely encodes implementation | No causal base/head validation yet | Open |
| T15 | In-memory or app-level rate limits fail across replicas | No distributed limiter is claimed | Host/control-plane limiter required |

## Preconditions for hostile pull requests

AgentShip must not advertise maintainer-safe execution until all of these are implemented and tested:

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
