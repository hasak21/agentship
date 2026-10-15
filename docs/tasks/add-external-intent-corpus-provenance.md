# Add external intent-corpus provenance

## Goal

Make externally sourced omission measurements auditable before importing representative
candidate results.

## Acceptance criteria

1. Add a distinct `external_evaluation` corpus kind; do not treat ordinary labeled
   fixtures as external evidence.
2. Require bounded dataset, immutable revision, exact dataset/predictions hashes, split,
   source URL, selection method, and retrieval-date provenance.
3. Bind every case to a unique external instance/candidate pair, repository, full base
   commit, exact candidate/outcome hashes, and credential-free HTTPS outcome-evidence URL.
4. Preserve corpus provenance and per-case source identity in benchmark JSON.
5. Reject malformed, duplicate, credential-bearing, or incomplete provenance in tests.

## Non-goals

- Claiming representative accuracy before independently evaluated candidate patches are
  imported and the sampling method is published.
- Downloading or executing third-party repository code.
