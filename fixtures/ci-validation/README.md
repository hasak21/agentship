# AgentShip CI validation fixture

This dependency-free npm project is an adoption fixture for a separate test repository.
Its build and lint commands perform syntax checks only; the test exercises clamp bounds.
Do not represent these checks as a production application build or broad defect corpus.

Copy this directory into a disposable repository and run the standalone AgentShip CLI's
`ci-init --ref <reviewed-full-commit-sha>`. Review and commit the generated policy and two
workflow callers to that repository's default branch before opening a validation PR.
The publisher's `workflow_run` caller must exist on the default branch to be exercised.

Validation cases:

1. Open a PR adding an assertion that `clamp(0, 0, 10)` equals `0`. Expect all checks to
   pass, structured evidence artifacts, and an always-neutral published Check Run.
2. Change the outer `Math.max` to `Math.min`. Expect the test check to fail, report verdict
   `BLOCK`, report-mode exit code `0`, and a neutral published Check Run preserving the
   blocker. Put `check:test` in a numbered PR requirement to exercise failed intent mapping.
3. Submit the same cases from a real fork. Verify the report uses the exact fork head,
   target-base policy, pinned verifier, a read-only token, and isolated checks. Then verify
   the privileged publisher's event binding, canonical report, attestation, and cache scope.

Retain report/publisher run URLs, head/base/verifier SHAs, report digests, Check Run
conclusion, attestation verification output, and any approval/cache behavior before marking
cross-repository or fork validation delivered. Run the standard `gh attestation verify`
procedure documented in `docs/CI_REPORT_MODE.md` of AgentShip against the target repository.

As of 2026-10-15, installation and both clean/regressed local cases passed their expected
outcomes in a separate disposable Git repository with all checks using Linux bubblewrap.
This is local preflight evidence only; live cross-repository and fork validation remain
pending. Creating a public repository requires explicit operator authorization.
