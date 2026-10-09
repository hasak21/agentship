# Local onboarding and readiness

The standalone CLI can create a conservative local policy for a Git repository with npm
scripts:

```bash
agentship init
agentship doctor
agentship review --task task.md
```

`init` detects only non-empty `lint`, `test`, and `build` scripts in `package.json`. It
creates `.agentship.yml` in report mode with bounded inputs, an aggregate check deadline,
per-check timeouts, and no optional checks. It refuses to invent commands, accepts no
arguments, and uses exclusive creation so it never overwrites an existing policy.

`doctor` is read-only. It validates the configuration, hashes the effective source, checks
required Linux bubblewrap and `prlimit` executables, and reports the backend readiness of
every check. It also warns when direct checks retain host-filesystem access or when a
`network: denied` declaration cannot be enforced without isolation. A blocked diagnosis
returns a nonzero exit status.

## Install neutral GitHub CI reporting

For an npm repository with a committed `package-lock.json` or `npm-shrinkwrap.json`, pin a
reviewed AgentShip commit and generate the three target-owned trust files:

```bash
agentship ci-init --ref <full-40-character-agentship-commit-sha>
```

Use `--repository owner/repository` when installing from a reviewed fork. The command
creates `.agentship.ci.yml` plus minimal report and publisher callers under
`.github/workflows/`. It never overwrites any of those files. Review and commit all three.

The report caller grants only `contents: read`. Its reusable workflow checks out verifier
code from the exact pinned AgentShip commit, policy from the target pull request's base
SHA, and the subject from the exact head SHA into separate directories. The publisher
caller grants the narrowly required Actions, Check Run, attestation, contents, and OIDC
permissions to a separate `workflow_run` stage. It parses the first stage's artifact as
bounded data and publishes an always-neutral Check Run; it does not execute artifact
content or block merging.

`ci-init` currently supports npm projects and deliberately requires a lockfile because
the hosted workflow uses `npm ci --ignore-scripts`. It does not publish the CLI, modify
repository settings, enable a required check, or claim that fork behavior is validated.
Keep the caller references and `verifier_ref` inputs identical and immutable when
upgrading; rerun is intentionally refused, so upgrades are reviewed edits.
