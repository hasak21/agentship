# Label missed findings

## Goal

Make recall measurable from explicit, corpus-bound human labels without implying that
local labels are authenticated, independently reproduced, or representative.

## Requirements

1. Record bounded missed-finding labels against exact report bytes and reject identities already emitted by that report.
2. Write labels exclusively inside a repository-relative directory and validate them again during aggregation.
3. Emit recall only when both missed labels and a complete hash-verified review corpus are explicitly supplied.
4. Expose recording and aggregation through the standalone CLI and cover report binding, duplicates, absent findings, and missing corpus input in tests.
5. Document the human-label provenance and representativeness limits without marking the public measurement milestone complete.

## Non-goals

- Authenticating the actor string or signing local records.
- Treating a human label as reproduced execution evidence.
- Claiming representative product recall from an uncurated local population.
