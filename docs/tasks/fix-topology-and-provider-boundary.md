# Fix topology dispatch and the public provider boundary

## Objective

Repair the self-consistency routing defect and prevent public requests from controlling upstream network destinations or inheriting server credentials.

## Requirements

1. Selecting `consistency` invokes only the self-consistency topology.
2. Unknown topology names fall back to the orchestrator.
3. Public API inputs cannot supply provider API keys or base URLs.
4. An explicit programmatic base URL without an explicit API key cannot inherit an environment credential.
5. Supported public provider and model selection continues to work.
6. Regression tests reproduce both security and dispatch boundaries.
