# LVBT app repository

A Turborepo workspace following the LVBT repository standard, with a Vite React app under `apps/app`
that deploys to Cloudflare Workers as static assets. Create a repository with
[LasVegasForTransit/template-with-vite-react](https://github.com/LasVegasForTransit/template-with-vite-react)
using **Use this template**, then clone your new repository. The generated standard is vendored, so
local setup does not need GitHub Packages authentication.

## Getting started

```bash
pnpm bootstrap   # install, wire git hooks, run preflight
pnpm check       # the same check CI runs
pnpm dev         # the app at http://127.0.0.1:5173
```

Then rename the root package and the Worker in `apps/deploy/cloudflare.config.ts`. Match that name
in `.lvbt/tooling.json` and choose a separate preview Worker name there. Replace the scopes in
`.lvbt/commit-scopes.txt` with this repository's boundaries. Local development needs no publishing
credentials.

## Layout

- `apps/app` is the Vite app: source under `src/`, unit tests under `tests/`, and end-to-end tests
  under `tests/e2e/`
- `apps/deploy` holds the `cf` Worker configuration and reads `apps/app/dist` after the app build
- `packages/` for libraries the site shares with other apps

## Releases

Follow the common
[web-release setup guide](https://github.com/LasVegasForTransit/repository-tooling/blob/main/docs/how-to/set-up-a-web-release.md)
for the account, permanent origins, protected preview, scoped credentials, and production readiness.
This app's canonical configuration is `apps/deploy/cloudflare.config.ts`; record its actual
production requirements in `apps/deploy/platform.json` before publishing.

Lint, format, TypeScript, and test settings extend the `@lasvegasfortransit/*` packages from
[`LasVegasForTransit/repository-tooling`](https://github.com/LasVegasForTransit/repository-tooling).
