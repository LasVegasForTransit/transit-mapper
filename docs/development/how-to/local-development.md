# Set up a local development environment

Use Node 24.20.x and pnpm 11.25.x; `package.json` records the supported
versions. Clone the application repository, then use the shared setup command:

```sh
git clone https://github.com/LasVegasForTransit/transit-mapper.git
cd transit-mapper
pnpm bootstrap
pnpm dev
```

The editor runs at `http://localhost:5173`. Local bootstrap installs dependencies,
wires Git hooks, records the installed toolchain and lockfile, and seeds
`apps/web/.env.development.local` only when absent. It preserves existing local
values. It needs no Cloudflare login, database provisioning, or repository admin
access. `pnpm preflight` checks that local setup without changing files.

The restricted analytics package comes from GitHub Packages. An installation
that reports registry access denied needs package read access configured in your
trusted user package-manager settings. This is package installation access;
production credentials are not needed for editor development. Ask a maintainer
for the organization's package access instructions, and keep credentials out of
shell commands, repository files, and troubleshooting logs.

## Running the share backend

Sharing, publishing Views, and loading shared links use the optional Worker:

```sh
pnpm worker:dev
```

Its local D1 database is separate from production. Local editor storage and
exports work without the backend. Leave the deployed database IDs and existing
Durable Object binding unchanged; remote provisioning belongs to the maintainer
[production setup](../../operations/how-to/set-up-production.md).

## Environment variables

`apps/web/.env` and `.env.development` provide public site URL defaults. Bootstrap
uses `.env.example` to seed `.env.development.local`, so local overrides apply only
to development and cannot replace the production build's site origin.

Web Analytics tokens are public and optional locally. Preflight warns when they
are absent; drawing, importing, rendering, saving, and testing continue. Set them
only when working on analytics. The production environment supplies both tokens
and enables its existing analytics requirement during release builds.

For locally fetched share metadata, a gitignored `apps/worker/.dev.vars` may set:

```dotenv
SITE_URL=http://localhost:8787
```

The deployed Worker configuration lives in `apps/worker/cloudflare.config.ts`.
Its D1 IDs come from the matching scopes in `wrangler.toml`; never point a local
or preview binding at production to repair development setup.

## Before opening a pull request

```sh
git switch -c codex/describe-your-change
pnpm check
```

`pnpm check` runs formatting, documentation checks, lint, types, tests, and the
existing product invariants through Turbo. A local bootstrap checks the machine;
it does not replace this change validation. Use `pnpm check:fix` for mechanical
repairs, then rerun `pnpm check`.

Open the pull request using the repository template. Same-repository branches get
a preview Worker linked in a comment; forks need maintainer help for a credentialed
preview. Inspect that preview for visual changes. Its shared scratch database and
Worker do not establish production acceptance. See
[pull request previews](../explanation/preview-deployments.md).

The existing Release Please workflow prepares a release pull request after merge.
Publishing the approved release runs the production build and performance gates.
Local setup does not deploy, promote, or publish a release.
