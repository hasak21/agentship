# Causal regression checks

An opt-in causal check demonstrates that the same test evidence passes on the proposed
revision and fails normally against the merge base. It requires `--base`, Linux
bubblewrap isolation, and explicit changed test or fixture paths:

```yaml
checks:
  - name: auth-regression
    run: npm test -- tests/auth/regression.test.ts
    required: true
    isolation: bubblewrap
    network: denied
    causal:
      expectation: fails_on_base
      testPaths:
        - tests/auth/**
```

AgentShip first runs the command on the proposed checkout. After it passes, AgentShip
creates a detached worktree at the merge base, overlays only changed files matching
`testPaths`, and runs the same command again in a fresh disposable sandbox. The report
records the exact base commit, configured patterns, overlaid files, and complete base
execution evidence. A normal nonzero base exit satisfies the causal expectation. A
passing, timed-out, or infrastructure-failed base execution produces the non-overridable
`causal_check_not_reproduced` blocker.

This proves that the declared test patch distinguishes base from head under the same
installed dependencies. It does not prove that the assertion is semantically correct,
that `testPaths` excludes all implementation code, or that dependency changes are
causal. Keep overlays narrow, review them as policy, and use a focused test command.
