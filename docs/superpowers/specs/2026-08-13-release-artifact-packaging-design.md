# Release artifact packaging design

## Problem

The production deployment job builds the Worker with Wrangler's `--outdir`
option and then assumes the emitted module is named `index.js`. The Worker
entry was renamed from `src/index.ts` to `src/entry.ts`, so Wrangler now emits
`entry.js`. The v0.5.0 release therefore failed while packaging its deployment
archive, before any Cloudflare mutation.

## Decision

The workflow will treat Wrangler's output directory as the deployment bundle.
It will copy that directory into the attested archive, discover exactly one
top-level JavaScript entry module (excluding source maps), and deploy that
discovered path from the extracted archive. This preserves any companion files
Wrangler may emit and fails safely if its output stops having an unambiguous
entry module.

## Alternatives considered

- Hard-code `entry.js`. This repairs v0.5.0 but repeats the coupling that
  caused the incident.
- Rename the Worker source back to `index.ts`. This changes application source
  merely to accommodate release packaging and does not protect future entry
  renames.
- Discover the generated entry module and archive the complete bundle. Chosen:
  it keeps the workflow aligned with Wrangler's actual output while retaining
  the attest-then-deploy guarantee.

## Verification

The regression proof is the real deployment preparation path: build the web
assets, run Wrangler's dry bundle, package the resulting directory, extract the
archive, and confirm that the discovered entry module exists. `pnpm check`
remains the full repository gate; GitHub's production workflow will then
attest, deploy, and smoke-test the generated release.
