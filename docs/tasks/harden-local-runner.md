# Harden the local deterministic runner

## Objective

Reduce accidental secret exposure and ensure timed-out checks do not continue running in the background.

## Requirements

1. Checks receive an allowlisted environment rather than the complete AgentShip process environment.
2. A check can explicitly request additional environment variable names.
3. Values from sensitive allowed variables are redacted from captured output.
4. Timeout handling terminates the check's process tree on POSIX and Windows.
5. Evidence records the names, but never the values, of variables supplied to a check.
6. Existing lint, test, and production-build checks continue to pass.
