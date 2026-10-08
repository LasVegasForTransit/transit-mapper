# Set up production from scratch

Production setup is a maintainer operation, separate from ordinary local
contributor setup. `apps/worker/platform.json` declares the Worker, production and
preview D1 databases, archive bucket, public domain, deploy credential, account
selectors, and production analytics variables. Shared LVBT tooling observes these
requirements and offers the steps to repair missing ones.

## Before you start

Use the LVBT Cloudflare account, Las Vegans for Better Transit, and the
`LasVegasForTransit/transit-mapper` GitHub repository. Existing credentials, D1
data, GTFS archives, routes, and Durable Object storage remain authoritative.
Do not recreate a resource simply because your current login cannot read it.

Complete [local setup](../../development/how-to/local-development.md), then use
maintainer GitHub and Cloudflare access for the production operation. The account
selector is public; set it for this session before a production readiness report:

```sh
export CLOUDFLARE_ACCOUNT_ID=2557b5c2e166292ded0f8425b73075e9
pnpm preflight --production
```

Preflight reads configuration and provider inventories. It never installs,
provisions, writes credentials, or asks for values. Missing provider access is an
unknown readiness result, not evidence that a resource is absent. Ordinary
`pnpm preflight` checks only the local checkout.

## Run the bootstrap

A maintainer runs this interactively after inspecting the readiness report:

```sh
pnpm bootstrap --production
```

Shared setup explains the planned actions and asks before starting. It preserves
existing secret values unless explicit rotation is requested. Public GitHub
variables and domain repairs have guided maintainer steps; conflicting domain
ownership is reported for investigation rather than reassigned automatically.
Repository governance uses the shared organization standard; local setup does not
create or administer GitHub repositories.

The database names are `transitmapper` for production and `transitmapper-preview`
for pull request scratch data. Both use `DB`, in separate configuration scopes.
Migrations wait until the selected scope names the correct database and its ID
agrees with provider inventory. Shared setup does not silently edit or commit
application configuration. If a database ID needs changing, update the matching
scope in `apps/worker/wrangler.toml` through a reviewed pull request;
`cloudflare.config.ts` reads those IDs. Keep production and preview IDs separate.

Run `pnpm check` after configuration edits, then inspect the pull request preview.
A passing local check or production inventory report does not prove a deployed
release. Confirm the protected deployment, the public Worker behavior, retained
maps and Views, and feed refresh separately using
[operations](operations.md).

## What each value is

### `CLOUDFLARE_API_TOKEN`

An account-owned deployment credential for Workers, D1 migrations, preview
cleanup, and GTFS refresh. Shared setup stores it on the `production` and
`preview` GitHub environments, never in application source. Existing account-wide
credentials can affect both environments; GitHub environment names do not isolate
Cloudflare permissions. Preserve existing credentials during this migration.

### `CLOUDFLARE_ACCOUNT_ID`

The public Cloudflare account selector. The manifest reads the session variable,
and readiness checks the matching variable on both GitHub environments. A
mismatch requires investigation; the tool does not overwrite it automatically.
Use GitHub Settings → Environments to repair a confirmed wrong value.

### `PUBLIC_LVBT_CWA_TOKEN` and `PUBLIC_LVBT_LABS_CWA_TOKEN`

Public analytics tokens on the `production` GitHub environment. Both refer to the
existing `lasvegasfortransit.org` Web Analytics property covering map and labs.
Release builds require them; local development only warns when absent. See
[analytics](analytics.md).

### The D1 database ids

Public identifiers committed in `apps/worker/wrangler.toml`, not credentials.
Production already has retained data. The preview scope uses the scratch
database. New IDs need a reviewed configuration change before migrations run.

## Make the deploy token

Only an authorized maintainer should create or rotate a production credential.
The manifest carries the instructions shown by shared setup:

1. Open the LVBT account in Cloudflare, then Manage Account → Account API Tokens.
2. Choose Create Token → Create Custom Token. Use an account-owned token and the
   name TransitMapper deploy (GitHub Actions).
3. Grant Account Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, and
   Account Settings Read; grant Zone Zone Read and Workers Routes Edit.
4. Restrict the account to LVBT and the zone to `lasvegasfortransit.org`.
5. Review expiry against the organization's credential policy and track renewal.
6. Create the token and paste it immediately into the waiting shared setup prompt.
   Cloudflare shows it once; setup does not print it or put it in command arguments.

R2 permission supports the daily feed refresh. No agent should create or replace
production credentials during a tooling migration.

## Find the Web Analytics tokens

1. Open Web Analytics in the LVBT Cloudflare account.
2. Manage the existing `lasvegasfortransit.org` property; do not create duplicate
   subdomain properties for map or labs.
3. Enable JS Snippet installation. TransitMapper loads the beacon itself.
4. Copy the 32-character public token from the snippet's `data-cf-beacon` value.
5. Set `PUBLIC_LVBT_CWA_TOKEN` and `PUBLIC_LVBT_LABS_CWA_TOKEN` under GitHub Settings
   → Environments → production → Environment variables.
6. Rerun `pnpm preflight --production` and verify the release build separately.

## Running it again

Shared setup observes first and acts on declared missing requirements. Existing
resources and secrets are preserved; unreadable inventories are reported as
unknown. `pnpm preflight --production` is the read-only report. An unstamped
installation from before the shared fingerprint warns to run local bootstrap;
an existing stale lockfile or toolchain fingerprint fails that local report.

## Replacing a value

A maintainer explicitly rotates the deploy credential with:

```sh
pnpm bootstrap --production --rotate CLOUDFLARE_API_TOKEN
```

Follow the token instructions, verify both GitHub targets were updated, confirm
deployment and GTFS refresh, then revoke the old credential. Do not confuse
presence of a stored secret with evidence that the provider accepts it.
Public account and analytics variables are repaired in their GitHub environment
settings after confirming the intended account and property.

## Not covered by the bootstrap

Provider acceptance, deployment, data retention, and public release behavior are
separate gates. Previews also need the account's registered `workers.dev`
subdomain. Follow [when a preview fails](operations.md#when-a-preview-fails) if the
preview target cannot be resolved. Preserve the existing release and performance
gates; this setup migration does not publish a release.

## Protected retained staging

The main release workflow now retains and signs a build before deploying only the
`transitmapper-preview` Worker. Production publication uses `pnpm promote` and the same
saved bytes. Existing `preview` and `production` credential environment names stay in use.

Before enabling that path, a maintainer must review the real `transitmapper-preview` D1
ID and the `LVBT_PREVIEW_BINDINGS` repository variable. The zero UUID in `wrangler.toml`
is a local placeholder and cannot pass shared release packaging. Update IDs only through
a reviewed configuration pull request; do not guess an ID or copy the production database.
The JSON declaration includes every canonical binding: `DB`, `GTFS_ARCHIVES`,
`PLACE_SEARCH_GATE`, six limiters, `ASSETS`, `SITE_URL`, and `NOMINATIM_URL`. The preview
Durable Object Worker is `transitmapper-preview`; limiter namespaces are `2001` through
`2006`, preserving the matching production periods and limits. `GTFS_ARCHIVES` deliberately
reads `transitmapper-data` through the reviewed read-only handler contract.

Protect `transitmapper-preview.las-vegas-for-better-transit.workers.dev` in Cloudflare Access
before the first saved deployment. An unauthenticated request must return denial. Add the
approved service token's `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` only to the
existing `preview` GitHub environment through maintainer setup. Production jobs receive
no Access credentials; they verify the successful same-run immutable candidate proof.
These are readiness requirements, not changes performed by an agent session.
