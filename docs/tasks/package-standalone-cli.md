# Package the standalone review CLI

## Objective

Produce a single executable Node artifact for `agentship review` that does not require the repository's TypeScript runtime or installed dependencies.

## Requirements

1. Bundle the CLI and its runtime dependencies into one Node 20-compatible file.
2. Declare the `agentship` executable in package metadata.
3. Verify the artifact from a temporary directory without `node_modules` resolution.
4. Add artifact verification as a required AgentShip self-review check.
5. Keep generated distribution files outside Git evidence.
6. Document both source-checkout and bundled CLI usage.
