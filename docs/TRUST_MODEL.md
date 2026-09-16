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

Paths explicitly annotated as ``change:path`` inside requirements are mapped to the observed changed-file set. Ordinary code-formatted paths remain context and are not treated as mandates. This mapping proves only that a named path changed, not that behavior is correct or the requirement is satisfied. Requirements without change annotations remain `unmapped`; AgentShip does not guess.

The report also lists changed files not matched by any explicit change annotation. These files are **unattributed**, not proven unrelated. This reverse-coverage view is evidence for human review and does not produce a finding by itself.

A requirement prefixed with `[confirm]` blocks gate-mode review until its stable requirement ID is supplied through `--confirm`. The report records whether confirmation was required or supplied. This is an explicit local operator assertion bound to the task and diff hashes; it is not authenticated identity, a signature, or attested approval. AgentShip does not yet infer which requirements are ambiguous or high impact.

Metrics from the explicit-path fixture corpus describe only deterministic annotation handling. They must not be presented as semantic missed-requirement recall; that requires a separate real or seeded defect corpus with independently known outcomes.

## Repository-state integrity

AgentShip captures the Git head and diff digest before and after executing checks. Any difference is a blocker because command results would otherwise describe a different repository state from the one named by the report. This detects mutation; isolated read-only execution remains a later maintainer-mode control.
