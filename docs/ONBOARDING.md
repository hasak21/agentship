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

This initializes local preflight only. It does not install the two-stage GitHub workflow,
publish a package, change repository settings, or claim that direct execution is safe for
hostile pull requests. Team CI onboarding remains a separate, reviewed deployment step.
