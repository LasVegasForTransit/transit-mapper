# LVBT site repository

A Turborepo workspace following the LVBT repository standard, with an Astro site under `apps/site`
that deploys to Cloudflare Workers as static assets. It was created with:

```bash
npx create-turbo@latest --example https://github.com/LasVegasForTransit/repository-tooling/tree/main/examples/with-astro
```

## Getting started

```bash
pnpm bootstrap   # install, wire git hooks, run preflight
pnpm check       # the same check CI runs
pnpm dev         # the site at http://127.0.0.1:4321
```

Then rename the root package and the Worker in `apps/site/wrangler.jsonc`, set `site` in
`apps/site/astro.config.ts`, and replace the scopes in `.lvbt/commit-scopes.txt` with this
repository's boundaries.

## Layout

- `apps/site` is the Astro site: pages under `src/pages`, layouts under `src/layouts`, Tailwind in
  `src/styles/global.css`, unit tests under `tests/`, end-to-end tests under `tests/e2e/`
- `packages/` for libraries the site shares with other apps

`pnpm run deploy` builds and runs `wrangler deploy` for every app with a wrangler config;
`.github/workflows/deploy.yml` does the same on every push to `main`.

Lint, format, TypeScript, and test settings extend the `@lvbt/*` packages from
[`LasVegasForTransit/repository-tooling`](https://github.com/LasVegasForTransit/repository-tooling).
