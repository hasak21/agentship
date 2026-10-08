# Isolated Linux checks

AgentShip can run an individual check through bubblewrap when the trusted policy declares
`isolation: bubblewrap`. This backend is opt-in and fails closed unless the host is Linux
and `/usr/bin/bwrap` exists.

## Enforced boundary

- A bounded copy of Git-tracked and non-ignored untracked subject files becomes the writable working directory; ignored local secrets are not copied.
- `.git`, `.agentship`, and `node_modules` are not copied.
- An existing `node_modules` directory is mounted at the expected path read-only.
- `/usr`, essential shared-library paths, and the active Node distribution are read-only.
- `/proc`, `/dev`, `/tmp`, and `HOME` are new sandbox-local instances.
- The host home and `/etc` are absent in the default denied-network profile.
- Credential-, token-, cookie-, password-, and secret-shaped environment names are removed; proxy variables survive only when their URLs contain no credentials, path, query, or fragment.
- PID, IPC, UTS, cgroup, user, and network namespaces are unshared.
- Repository mutations and generated artifacts disappear when the worker exits.
- The copy rejects special files and is capped at 200,000 entries and 2 GiB.
- Configured `prlimit` bounds wrap bubblewrap itself and are inherited by worker processes.

The default effective network mode is `denied`, even when `network` is omitted. A trusted
`network: allowed` declaration adds `--share-net` and exposes read-only TLS certificates,
resolver configuration, and host networking. This can reach runner-local services and
must be used only when the check genuinely requires it.

## Evidence

JSON and Markdown reports record `linux-bubblewrap`, `disposable-copy`,
`minimal-read-only-runtime`, and the effective `allowed` or `denied` network mode. A
skipped check records the requested isolation policy but remains `not_executed`.

## Residual risk

Bubblewrap is namespace isolation, not a virtual machine. It shares the host kernel and
does not currently apply seccomp, cgroup-wide CPU/memory/process accounting, or a strict
tmpfs/disk-capacity quota. Read-only runtime and dependency files are still visible.
Name-based environment filtering cannot recognize a secret stored under an innocuous
custom variable name; trusted policies must not request such values for hostile checks.
Copying occurs before sandbox entry, so the entry/byte bounds protect availability but do
not eliminate all filesystem race or decompression-style risks. User-installed toolchains
outside `/usr` and the active Node distribution are not mounted automatically.

The official GitHub workflow provisions a fixed Ubuntu Noble amd64 package from the
security archive and verifies its published SHA-256 before installation. It rejects the
wrong platform, package/runtime version, setuid mode, or failed namespace smoke test
before any pull-request command runs. All official checks use this backend; lint, tests,
the Next build, and CLI packaging all deny network. The build uses repository-owned Geist
v1.7.2 variable fonts whose source commit, hashes, and SIL OFL license are retained beside
the assets.
The installer itself remains trusted-base code and updating its package pin requires
review like any other verifier change.

AgentShip's own Linux policy is `.agentship.bubblewrap.yml`; every check is offline. The
portable and CI policies also declare every check denied, but only an isolation backend
enforces that declaration rather than merely recording it as evidence.
