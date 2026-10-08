# Vendored Geist fonts

These are the variable WOFF2 assets from Vercel's Geist v1.7.2 release at commit
`a73329da8fc62afc917f796555202e4997f79b7c`:

- `Geist-Variable.woff2` — SHA-256 `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`
- `GeistMono-Variable.woff2` — SHA-256 `afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101`
- `LICENSE.txt` — SHA-256 `930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137`

Source paths:

- `packages/next/dist/fonts/geist-sans/Geist-Variable.woff2`
- `packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2`
- `LICENSE.txt`

The font software is distributed under the included SIL Open Font License 1.1. Pinning
the exact assets removes build-time Google Fonts requests and lets hostile-code checks
run with network isolation.
