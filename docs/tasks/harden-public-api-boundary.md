# Harden the public API boundary

## Objective

Bound request resource usage and provide an authentication boundary when AgentShip is exposed beyond a trusted local machine.

## Requirements

1. Development and production servers bind to localhost by default.
2. Audit, research, and MCP JSON bodies have explicit byte limits.
3. Invalid media types, JSON, and non-object bodies receive client errors.
4. Setting `AGENTSHIP_API_TOKEN` requires a matching bearer token on expensive POST endpoints.
5. Local development remains open when no access token is configured.
6. Request-boundary behavior has deterministic unit coverage.
