# Import SWE-bench evaluation evidence

## Goal

Turn independently produced, official-format SWE-bench artifacts into a hash-bound
AgentShip external intent corpus without executing or fetching third-party code.

## Acceptance criteria

1. Join immutable task records, official prediction records, and per-instance evaluator
   reports by exact instance ID; reject missing and duplicate records.
2. Derive changed paths from bounded candidate patches and resolved/unresolved labels only
   from completed evaluator reports; reject infrastructure failures and unsafe paths.
3. Bind exact dataset, predictions, patch, and outcome-report bytes by SHA-256 and require
   an immutable credential-free evidence URL.
4. Refuse to overwrite output and preserve all external provenance in a corpus accepted by
   `agentship benchmark`.
5. Cover the importer module and bundled CLI flow with deterministic fixtures.

## Non-goals

- Downloading the dataset, predictions, or evaluation artifacts.
- Running repository code or the SWE-bench evaluator.
- Claiming that an imported run is representative.
