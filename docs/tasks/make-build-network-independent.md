# Make the build network-independent

Remove the last host-network exception from official hostile-code checks by self-hosting
the web UI's fonts with pinned, licensed assets.

## Requirements

1. [confirm] Replace the Google font loader with `next/font/local` and preserve the existing Sans/Mono CSS variables in `change:src/app/layout.tsx`.
2. [confirm] Vendor exact Geist v1.7.2 variable WOFF2 assets, their SIL Open Font License, and immutable source/hash provenance under `change:src/app/fonts/**`.
3. Deny network for every check in `change:.agentship.yml`, `change:.agentship.bubblewrap.yml`, and `change:.agentship.ci.yml`.
4. Prove local-loader usage, fixed asset hashes, and all-policy network denial in `change:tests/local-fonts.test.ts`; require `check:test`, `check:lint`, and `check:build`.
5. Document the closed build exception and remaining dependency-install, host-kernel, and non-isolated-local risks in `change:README.md`, `change:docs/CI_REPORT_MODE.md`, `change:docs/ISOLATED_CHECKS.md`, `change:docs/TRUST_MODEL.md`, `change:docs/THREAT_MODEL.md`, and `change:docs/DEVELOPMENT_PLAN.md`.

## Non-goals

- Claiming that `npm ci --ignore-scripts` is network-free or sandboxed.
- Claiming network enforcement for direct, non-isolated local checks.
- Changing the visible typography or CSS variable contract.
