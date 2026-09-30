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

Then rename the root package and the Worker in `apps/deploy/cloudflare.config.ts`, and replace the
scopes in `.lvbt/commit-scopes.txt` with this repository's boundaries.

## Layout

- `apps/app` is the Vite app: source under `src/`, unit tests under `tests/`, and end-to-end tests
  under `tests/e2e/`
- `apps/deploy` holds the `cf` Worker configuration and reads `apps/app/dist` after the app build
- `packages/` for libraries the site shares with other apps

`pnpm run deploy` builds the app and deploys the canonical `cf` project in `apps/deploy`;
`.github/workflows/deploy.yml` does the same on every push to `main`.

Lint, format, TypeScript, and test settings extend the `@lasvegasfortransit/*` packages from
[`LasVegasForTransit/repository-tooling`](https://github.com/LasVegasForTransit/repository-tooling).
