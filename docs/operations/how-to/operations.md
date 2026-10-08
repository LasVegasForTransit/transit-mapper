# Run TransitMapper in production

Everything here needs access to the LVBT (Las Vegans for Better Transit)
Cloudflare account. If you don't have it, the person who does is the one who can act on
any of this.

Production-only measurement setup and verification are documented in
[Operate TransitMapper analytics](analytics.md). To set production up for the
first time, or to check that an existing setup is complete, follow
[Set up production from scratch](set-up-production.md).

Production is one Cloudflare Worker (`transitmapper`) on
`map.lasvegasfortransit.org` and
`labs.lasvegasfortransit.org/transit-mapper`. It serves the built SPA as static
assets and handles `/api/*`, `/s/*`, `/v/*`, `/e/*` and `/embed/*` itself. Both
hostnames use the same D1 database (also `transitmapper`) for shared systems and
short-lived anonymous performance samples. The Labs route is an alias for the
current project, not a graduation or a separate deployment.

The Labs Worker route strips `/transit-mapper` before routing API and reader
requests or fetching built assets. HTML responses prefix root-relative asset
paths so the Vite build works on both hostnames. The browser path helper keeps
navigation, API calls, and local map-font requests under the Labs prefix. The
web manifest uses relative launch, scope, and icon URLs so installation stays
within whichever hostname and path served it. A Labs route deployment must
pass direct refresh checks for the editor, a built JS asset, a share page, and
an API request; the map hostname remains the canonical public address.

## Deploy

Conventional commits merged to `main` run `Validate` and the existing production-build
RTC, route, and onboarding performance gates. Release Please keeps the version,
changelog, release pull request, tag, and GitHub release together. Its generated pull
request still receives explicit validation and performance dispatches because GitHub
suppresses events created by the workflow token.

The [staging workflow](../../../.github/workflows/deploy-production.yml) calls the shared
retained-release build, signing, and publication workflows at the recorded tooling
revision. It retains the exact compiled Worker, static assets, settings, and migration
SQL for 90 days, then publishes only the protected `transitmapper-preview` Worker.
A merge never activates production. The staged artifact retains the production asset
identity; its preview Worker marks responses non-indexable and serves no sitemap.

TransitMapper implements a SQLite Durable Object, so per-version preview URLs are not
available. Named staging keeps the production `PlaceSearchGate` class and Worker
namespace unchanged while selecting a separate preview namespace and D1 database.
Preview cron schedules stay disabled. Preview rate-limit IDs are account-scoped and
distinct from production; their budgets remain identical. The public GTFS R2 dataset
is deliberately shared through the reviewed `GTFS_ARCHIVES` read-only contract:
preview handlers and Durable Objects receive only `get`, `head`, and `list`. Compiled
modules using native global binding access or unverified dynamic imports are rejected.

After reviewing the protected staging result, publish the retained release explicitly:

```bash
pnpm promote
pnpm promote -- --run-id <successful-staging-run>
```

The [promotion workflow](../../../.github/workflows/promote.yml) resolves the actual
protected preview or the specified successful staging run. The shared source verifier
checks the saved source identity and provenance. Candidate acceptance runs in the
existing `preview` credential environment; production activation runs separately in
`production` and consumes the immutable proof from that same manual run. The proof
binds the selected source, artifact hash, tools revision, preview namespace, and checks.
Access headers are confined to the reviewed preview origin and never reach production
or third-party browser requests.

The deployed acceptance extension keeps every existing HTTP route, security header,
entry-chunk identity, RTC interaction, and onboarding walkthrough check. Preview SQL
applies from the saved artifact before candidate checks; production SQL applies after
candidate acceptance and immediately before activation. The previous application
continues serving during migrations, so schema changes must be additive. Neither stage
reads migration SQL from a newer checkout. A production failure after activation means
bytes may already be live; verify the live marker and reconcile the workflow before
retrying or rolling back.

Release Please attaches the archived saved inputs, signed exact inventory, and signature
bundle to a newly published version only when the tag resolves to that artifact's source
commit. The signature subject is `release-attestation.json`, whose inventory covers every
saved Worker, asset, setting, and SQL byte. Shared verification pins the upstream signer
workflow and its full commit, checks the source commit and default branch, and compares
the signed inventory to the verified artifact. Production does not rebuild or rebundle.
Old archives from the former deployment workflow keep their original signature format;
new automatic deployment does not consume those archives.

A failed source build can be rerun after its cause is fixed. A dispatch whose result is
unknown must be reconciled using its correlation ID and unique workflow run; do not
create another promotion blindly. Retained releases older than the Actions artifact
retention period require a new reviewed staging build. `pnpm run deploy` delegates to
explicit saved-release promotion as well.

The only required merge-queue check remains `Validate`. The Performance workflow keeps
its existing pull-request relevance and diagnostic budgets. A documented nonblank manual
performance override can still allow Release Please to prepare a version, but retained
staging builds continue requiring the performance gates. Do not edit versions, tags,
changelogs, or build revisions by hand. An explicit `Release-As` marker must include a
tracked change because a rebase merge drops empty commits.

Field-sampling settings remain build inputs. The defaults are enabled, 100 ordinary basis
points and 500 release basis points; GPC/DNT and the production-origin restriction remain
in force. Builds without a verified release tag do not claim a published release.

### When a deploy fails

- **Validate or Release performance gates** — fix the source, browser journey, or build
  failure before staging. These gates do not write provider state.
- **Prepare or publish release** — check the Release Please permissions and default-branch
  rules; this job versions the project and does not activate production.
- **Build or attest** — nothing has reached Cloudflare. Fix the reproducible build or
  signer permissions before retaining another artifact.
- **Preview readiness or anonymous protection** — a maintainer must supply the reviewed
  preview database declaration, preview credentials, and Access protection. No placeholder
  D1 ID is deployable. See [production setup](set-up-production.md).
- **Apply retained schema** — earlier SQL may have applied. Inspect the selected database
  and reconcile before retrying; the command cannot reverse migrations.
- **Upload or activation** — provider outcome may be unknown. Inspect the selected Worker,
  version, and live release marker before retrying or promoting.
- **HTTP, browser, or final publication verification** — inspect the exact failing assertion.
  If activation already ran, fix forward or follow [rollback](#roll-back).

## Managed GTFS archives

Production uses the `transitmapper-data` R2 bucket. The refresh workflow checks
for it and creates it through the Cloudflare API before it downloads a feed.
The `production` environment token needs `Account · Workers R2 Storage · Edit`,
which the custom token setup explicitly includes.
Do not put that token on a command line; dispatch the workflow instead.

The daily `Refresh GTFS feeds` workflow runs at 09:17 UTC. It downloads each
configured source in sequence, validates the files and columns TransitMapper
imports, and writes `gtfs/<slug>/current.zip` only after validation succeeds.
A failure leaves that feed's previous object untouched. Run one feed manually
from an authenticated checkout with:

```bash
GTFS_FEED_SLUG=rtc pnpm refresh:gtfs
```

Adding another feed requires one entry in `apps/worker/src/gtfs-feeds.ts`.
Choose a stable lowercase kebab-case slug. Use an HTTPS source URL. Run the
refresh tests, dispatch the workflow for that slug, and confirm the list and
archive routes before announcing it:

```bash
curl -fsS https://map.lasvegasfortransit.org/api/v1/gtfs
curl -fsS -o /dev/null -D - https://map.lasvegasfortransit.org/api/v1/gtfs/<slug>
```

Do not upload an unvalidated archive by hand. The fixed object key is the
last-good boundary, so replacing it bypasses the protection the refresh script
provides.

## Roll back

Cloudflare keeps previous Worker versions. List them, then promote a known
good one. Note that `rollback` takes a **version** id, not a deployment id —
`wrangler versions list` is the command that prints the right one:

```bash
pnpm --filter @transitmapper/worker exec wrangler versions list
```

```bash
pnpm --filter @transitmapper/worker exec wrangler rollback <version-id>
```

A rollback moves **code only**. Migrations are not reversed, which is the
reason for the migration rule below — if the previous version can't run
against the current schema, rolling back doesn't help and you need a
fix-forward deploy instead.

## Migrations

The promotion workflow applies the selected artifact’s frozen migrations before activating
production code. Preview migrations run before candidate acceptance. To inspect production:

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 migrations list transitmapper --remote
```

Add a migration as a new `.sql` file in `apps/worker/src/migrations/`;
Wrangler applies them in filename order and never re-runs one. Never edit a
migration that has already run.

**Additive migrations only, in a single release.** A new nullable column that
the currently-running code ignores is safe: the schema changes first, the code
follows seconds later, and the old code doesn't care. Anything that removes or
rewrites a column is not safe in either order, because both versions are live
during a deploy. Split it across two releases — first ship code that no longer
depends on the column, then ship the migration that drops it.

## Restore

D1 has Time Travel: it keeps a restorable history without any backup job.

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 time-travel info transitmapper
```

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 time-travel restore transitmapper --timestamp=<unix-seconds>
```

Worth knowing before you need it: the `systems` table holds shared snapshots
only. Nobody's working copy lives there — that's in their own browser's
localStorage — so losing this table costs shared links, not people's systems.

## Incidents

Worker logs are on at 100% sampling:

```bash
pnpm --filter @transitmapper/worker exec wrangler tail
```

### Performance sample maintenance

The midnight UTC cron has independent concerns: it removes expired shares,
rolls up every complete UTC performance-sample day that is not marked
complete, and applies retention. Each build/surface/cache/service-worker/
device/network/capability cohort becomes one row in
`performance_daily_aggregates`; `metrics_json` contains only server-generated
fixed metric keys with count, minimum, nearest-rank p50/p75/p95, maximum, and
mean. Raw `performance_samples` rows are kept for seven days and deleted only
after their day has a completion marker. Aggregate rows and completion markers
are kept for 90 days.

Each rollup transaction gives its marker an ephemeral owner token and gates
every delete/insert in that batch on the same token. If two cron invocations
overlap, one owns the day and the other commits a no-op; correctness does not
depend on D1's formatted constraint-error text. A token is operational
coordination only, is never derived from a browser sample, and is deleted with
the 90-day marker.

D1 Time Travel can restore rows that ordinary retention already removed. After
any database restore, let the midnight maintenance run or invoke the same
scheduled Worker path, then repeat the volume queries below and confirm that
restored raw rows older than seven days and aggregates older than 90 days were
removed again. A restore is not complete until that cleanup is verified.

Inspect volume and aggregation progress without selecting individual raw
measurements:

```sql
SELECT date(received_at / 1000, 'unixepoch') AS day, COUNT(*) AS samples
FROM performance_samples
GROUP BY day
ORDER BY day DESC;
```

```sql
SELECT datetime(day_start / 1000, 'unixepoch') AS day,
       COUNT(*) AS cohorts,
       SUM(sample_count) AS samples
FROM performance_daily_aggregates
GROUP BY day_start
ORDER BY day_start DESC;
```

Run them with `wrangler d1 execute transitmapper --remote --command '<SQL>'`.
If an old raw day remains, first look for a missing row in
`performance_sample_aggregation_days` and an aggregation error in Worker logs.
Do not delete the raw day until aggregation succeeds; the cron retries partial
rollups deterministically. A telemetry aggregation failure must not stop
expired-share cleanup, and vice versa.

**There is no alerting.** Nothing pages anyone, emails anyone, or opens a
ticket when the Worker throws — the logs above are a place to look, not a
thing that tells you to look. Until that changes, production failures are
found by someone noticing, so it's worth running the smoke test by hand after
anything unusual:

```bash
curl -sSI https://map.lasvegasfortransit.org/ | grep -i content-security-policy
```

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://map.lasvegasfortransit.org/s/zzzzzzzzzz
```

The first should print a CSP header; the second should print `404` and
`text/html`. A `200` on the second means the Worker isn't running for `/s/*`
and every share link, preview image and embed is silently broken.

After an OpenStreetMap gateway release, verify both resource routes before a
controlled metro import:

```bash
curl -sS 'https://map.lasvegasfortransit.org/api/places?q=Las%20Vegas%20Valley'
```

```bash
curl -sS 'https://map.lasvegasfortransit.org/api/openstreetmap/ways?west=-115.20&south=36.10&east=-115.19&north=36.11&categories=road,bike'
```

Both return JSON with `results` or `elements`. Errors carry `code`, `error`,
and `retryable`; rate-limited responses also carry `Retry-After`. Place
searches are limited to 10 per client per minute and OSM tiles to 60. An
uncached place search also passes through `PLACE_UPSTREAM_LIMITER`, capped at
one request per ten seconds in each Cloudflare location, then reserves the
application-wide one-request-per-second slot through `PLACE_SEARCH_GATE`;
cached results consume neither budget. The rate-limit binding rejects local
bursts while the SQLite-backed Durable Object supplies the strongly consistent
global guarantee. Successful place and tile responses cache for seven days
and one day respectively; failures must not have a public cache lifetime.
`NOMINATIM_URL` selects the geocoder so an operator can move to another
compatible provider without rebuilding the Worker.

For an import incident, tail logs while reproducing one small tile. A sequence
of mirror failures followed by a success is normal failover. Persistent
`upstream_invalid` points to a changed upstream payload; `tile_too_dense`
should cause browser-side subdivision rather than end the whole import. Both
geocoding and Overpass reads have application deadlines and decoded response
ceilings, so a stalled or unbounded upstream cannot hold a Worker invocation
open. Do not bypass the gateway with browser-to-Overpass fetching: that would
remove the shared limits, cache, response ceiling, and identifying headers required by
the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)
and [Overpass commons guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Pull request previews

Every push to an open pull request deploys the branch to its own URL and
comments the link on the pull request:

```text
https://transitmapper-pr-<number>.<subdomain>.workers.dev
```

It is the same build production gets, pointed at that hostname, and it runs
the same route smoke and browser walkthrough the production deploy runs.
Closing the pull request deletes it.

Pull requests from forks get no preview, and the run says so. So does a
repository whose `preview` environment has no credentials yet: the deploy is
skipped rather than failed, because that is a setup step nobody can do from
the pull request. Why it works this way, and what the security boundary
actually is, is in
[pull request previews](../../development/explanation/preview-deployments.md).

### The preview database

Every open pull request shares one D1 database, `transitmapper-preview`. It
holds nothing worth keeping. If an abandoned branch's migration leaves it in a
state you no longer want, replace it:

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 delete transitmapper-preview
pnpm bootstrap --production
```

The bootstrap sees that the preview database is gone, asks to create it, and
reports the new ID. Update the `[env.preview]` block of
`apps/worker/wrangler.toml` through a reviewed pull request before applying
migrations. `cloudflare.config.ts` reads that ID when
building the preview Worker. Commit the changed TOML through a pull request.
Do not drop the tables instead: the
`d1_migrations` bookkeeping table has to go with the schema, or the next
deploy believes every migration has already been applied.

Closing a pull request deletes its Worker and the Durable Object storage that
went with it. It leaves behind whatever that preview wrote to the shared
database.

### When a preview fails

- **Resolve the preview target** — the token cannot read the account's
  `workers.dev` subdomain, or the account has never registered one. Register
  it once in the Cloudflare dashboard under Workers & Pages → Subdomain.
- **Resolve the preview database** — the token cannot list the shared D1
  database, or it does not exist. Check the `preview` environment token and
  run `pnpm bootstrap --production` if the database is missing.
- **Apply D1 migrations** — usually two pull requests raced each other against
  the shared database. Re-run the job. If it fails again, look at the
  migration itself.
- **Deploy preview**, failing the Build Output check — the built Worker name,
  URL, database, routes, or triggers differ from this pull request's target.
  Do not retry until the generated configuration and `cf` preview mode agree.
- **Verify the deployed site** — the Worker is up but serving something other
  than the build. The URL works and the comment has already been posted, so
  read this exactly as the production smoke failure above.
- **Delete the preview Worker** — teardown tolerates a Worker that was never
  created and fails on anything else, so a red teardown means the API refused.
  Check the token on the `preview` environment. Until it is fixed, every
  closed pull request leaves a Worker behind.

## Not yet configured

Stated plainly so nobody assumes otherwise:

- **No alerting.** See above.
- **Staging readiness requires maintainer verification.** The retained staging workflow
  is implemented, but deployment requires a real preview D1 declaration and a protected
  preview origin. No agent session provisions resources or sets credentials. Local checks
  alone do not establish a live staged or production release.
- **No error reporting service.** `console.error` in the Worker goes to the
  log stream and nowhere else.
