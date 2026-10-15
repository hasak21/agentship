# Bound isolated writable storage

## Goal

Prevent an isolated repository check from retaining unbounded generated data in its
disposable workspace or private temporary directory without overstating a sampled monitor
as a kernel-enforced filesystem quota.

## Acceptance criteria

1. Add a bounded positive `resources.maxWorkspaceMiB` policy that is valid only with
   bubblewrap isolation.
2. Measure aggregate logical bytes across the writable workspace and private `/tmp`
   before execution, during execution, and after process exit.
3. Fail closed and terminate the process tree when the bound is exceeded or accounting
   fails; retain the configured limit, maximum observation, and result in evidence, with
   a distinct non-overridable blocker for a measured excess.
4. Apply a conservative bound to generated CI policies and AgentShip's official policies.
5. Cover configuration, accounting, report evidence, and live bubblewrap enforcement when
   the host permits namespace creation.

## Non-goals

- Claiming a hard filesystem quota or detection of every transient create/delete spike.
- Replacing cgroup-wide CPU, memory, or process-count accounting.
