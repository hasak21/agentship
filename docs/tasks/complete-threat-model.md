# Complete the hostile-repository threat model

## Objective

Define the assets, trust boundaries, adversaries, current controls, and open prerequisites for safely reviewing hostile pull requests.

## Requirements

1. Cover the CLI, web endpoints, providers, evidence artifacts, and future CI runner.
2. Separate trusted-local execution from hostile-repository execution.
3. Record current controls without presenting detection as prevention.
4. Include prompt injection, secret theft, policy tampering, resource abuse, and evidence tampering.
5. Define explicit prerequisites before maintainer-safe execution may be claimed.
6. Require future high-impact threats to preempt lower-risk feature work.
