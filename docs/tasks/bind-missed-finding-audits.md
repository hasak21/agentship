# Bind missed-finding audits

## Goal

Prevent an incomplete or empty missed-label directory from implying measured recall.

## Requirements

1. Record a bounded, immutable completed-audit claim against exact report bytes and the digest of its complete current missed-label set, including an empty set.
2. During outcome aggregation, require both labels and audits, reject stale or duplicate audits, and reject labels from reports without completed audits.
3. Compute recall only from accepted/fixed findings and missed labels in audited reports; expose audited-report count and corpus coverage.
4. Expose audit recording through the standalone CLI and verify its interaction with outcome metrics.
5. Document that audit completion, actor identity, and sample representativeness remain human claims.
