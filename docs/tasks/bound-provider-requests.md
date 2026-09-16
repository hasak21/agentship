# Bound outbound provider requests

## Objective

Ensure stalled LLM provider requests terminate before supervisor retries can leave orphaned, billable network work.

## Requirements

1. Every supported provider protocol uses an aborting request timeout.
2. The default timeout is shorter than the research-node supervisor deadline.
3. Deployments can configure the default with `LLM_REQUEST_TIMEOUT_MS`.
4. Trusted programmatic callers can override the timeout per request.
5. Invalid non-positive timeout values fail before network access.
6. Regression coverage proves that timeout expiry aborts the underlying fetch.
