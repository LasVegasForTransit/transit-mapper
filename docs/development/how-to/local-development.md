# Set up a local development environment

Requirements: Node 24+ and [pnpm](https://pnpm.io). (`package.json` sets
`engines.node` to `>=24`, and CI runs on 24 — an older Node fails in ways that
don't obviously point at the version.)

```sh
git clone git@github.com:WillieCubed/transit-mapper.git
cd transit-mapper
pnpm install
pnpm dev
```

The editor runs at `http://localhost:5173` with no backend required.

## Running the share backend

Sharing and forking a system needs a Cloudflare Worker with a D1 database.
It's optional for most development:

```sh
pnpm worker:dev
```

Without it running, the rest of the editor still works; only **Share**
and loading a shared link are unavailable.

## Environment variables

`apps/web/.env` and `apps/web/.env.development` set `VITE_SITE_URL` —
the site origin used to build absolute URLs (Open Graph/Twitter tags,
canonical link) in `index.html`. Both are committed; this is public
config, not a secret, and Vite picks the right one automatically
(`.env.development` overrides `.env` when running `pnpm dev`). You
shouldn't need to touch either for normal development.

`apps/worker/wrangler.toml` sets `SITE_URL` the same way for the
Worker's dynamic per-share meta tags (`/s/:id`). If you want
locally-fetched tags to show `http://localhost:8787` instead of the
production domain while running `pnpm worker:dev`, create a gitignored
`apps/worker/.dev.vars`:

```
SITE_URL=http://localhost:8787
```

This is optional — nothing breaks if you skip it, the tags just show
the production URL even when hit locally.

## Before opening a pull request

```sh
pnpm typecheck
pnpm verify
```

Both need to pass. `verify` runs the package test suites, including the
deterministic `apps/web/tests/verify.test.ts` suite, with no browser needed.

`typecheck`, `build`, and `verify` all run through
[Turborepo](https://turborepo.com) for caching, so a repeat run with
unchanged inputs replays instantly instead of re-invoking `tsc`/`vite`/`tsx`.
