# Run TransitMapper in production

Everything here needs access to the Las Vegas for Better Transit Cloudflare
account. If you don't have it, the person who does is the one who can act on
any of this.

Production is one Cloudflare Worker (`transitmapper`) on
`map.lasvegasfortransit.org`, serving the built SPA as static assets and
handling `/api/*`, `/s/*` and `/e/*` itself, with one D1 database (also
`transitmapper`) holding shared systems and short-lived anonymous performance
samples.

## Deploy

Releases and deploys are automatic. Conventional commits merged to `main`
first run `Validate`, the repeated RTC audit, and the public first-session and
onboarding production-build smokes. Release Please runs only after all four
gates pass.
It creates or updates one release pull request with the calculated version and
changelog. Merging that pull request creates the matching tag and GitHub
release. The same workflow then builds and attests a deployment archive,
applies pending D1 migrations from it, deploys its exact Worker and web files,
checks the live bundle and routes, then exercises the deployed RTC editor and
onboarding dialog in headless Chrome. Because GitHub suppresses pull-request events
created by a workflow token, the release job explicitly dispatches `Validate`
and the `release` scope of the Performance workflow on the generated branch.

The required pull-request context is `RTC responsiveness (desktop)`. The
Performance workflow always reports it. It runs Chrome when `apps/web`,
`packages/core`, the root package or workspace manifests, the lockfile, the
Node setup action, or the performance workflow changed. Documentation and
worker-only pull requests still report the terminal check without opening
Chrome.

Ordinary feature merges therefore do not deploy immediately. They accumulate
in the generated release pull request until that pull request is merged. Do
not edit the version, changelog, release tag, or build revision by hand; the
root manifest, conventional commits, and GitHub event are their canonical
sources.

Release builds embed the field-sampling policy alongside their public build
identity. Defaults are enabled, 100 ordinary basis points (1%), and 500 release
basis points (5%) until 24 hours after the build. A deployment can set
`TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED=0` as a build-time kill switch or
set `TRANSITMAPPER_PERFORMANCE_ORDINARY_BASIS_POINTS` and
`TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS` to integers from 0 through 10000. These are build inputs, not live Worker switches: changing one requires
a new web build and deployment. The client still refuses local, untagged, or
wrong-origin builds and honors GPC/DNT regardless of these values.

When a release must proceed while a known performance regression remains, run
the production workflow manually with **Continue after failed performance
gates** enabled and provide a nonblank reason. The workflow still runs every
performance job and keeps each failure visible. It records the reason in the
run summary before Release Please runs. Push-triggered releases cannot use this
override, and a failed `Validate` job always blocks the release.

If Release Please creates the GitHub release but the deploy job does not run,
dispatch the production workflow again from the release commit. Set **Existing
release tag at this commit to deploy** to the published tag. The workflow
requires the tag to reference the exact commit that the new run validates. It
then builds, attests, migrates, deploys, and smokes that tag without creating a
second release. Use the performance override and reason when the recorded gates
still fail.

[`deploy-production.yml`](../../../.github/workflows/deploy-production.yml)
attaches the deployment archive and its Sigstore bundle to every GitHub
release. To verify a downloaded archive was built by this repository's GitHub
Actions workflow:

```bash
gh attestation verify transitmapper-v<VERSION>-deployment.tar.gz \
  --repo LasVegasForTransit/transit-mapper
```

The archive contains Wrangler's complete dry-run output rather than a
source-named entry file. Wrangler generates that filename, so the workflow
requires exactly one top-level JavaScript entry in the bundle and discovers it
again after extraction. This keeps the attested release asset and the
`--no-bundle` Cloudflare deployment aligned even when the Worker source entry
is renamed.

The About dialog links the running build to its release, source revision, and
repository attestations. The attestation proves the release archive's GitHub
Actions origin; the workflow's production deployment record and entry-chunk
smoke test establish that the same extracted archive was sent to Cloudflare.

Because nothing applied migrations automatically before this workflow existed,
the first automated deploy after it lands applies whatever backlog production
has accumulated — so check the backlog is what you expect _before_ merging a
change to this workflow, not after:

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 migrations list transitmapper --remote
```

`0002_share_expiry.sql` begins with `DELETE FROM systems`, which is harmless
only because it has already run. Confirm that before trusting the automation
with it.

You should not normally need to deploy by hand. If you do:

```bash
pnpm run deploy
```

Be aware that this deploys whatever is in your working tree, straight to the
public site, with no checks — there is no staging environment. Run
`pnpm typecheck && pnpm verify` first.

### When a deploy fails

Check which step failed before anything else; they fail for unrelated reasons.

- **Validate** — a real test or type failure. Fix it on a branch.
- **Release performance gates** — one of the RTC, public first-session, or
  onboarding production-build smokes failed. Fix the browser journey or build
  problem before Release Please runs. A maintainer may use the documented
  manual override when shipping a known regression is safer than holding the
  release. The override does not hide the failed jobs or change their budgets.
- **Prepare or publish release** — Release Please could not update its release
  pull request or create the tag and GitHub release. Check the job's repository
  permissions and default-branch rules. Repository Actions settings must allow
  workflows to create pull requests; `pnpm bootstrap` keeps this setting in
  sync while leaving the default workflow token read-only. If the organization
  locks that setting off, an organization owner must enable workflow-created
  pull requests once under the organization's Actions settings before a
  repository workflow can change it.
- **Build release**, **Bundle Worker**, **Package deployment artifact**, or
  **Attest deployment artifact** — nothing has reached Cloudflare. Fix the
  reproducible build or the workflow's `id-token` and `attestations`
  permissions, then rerun the failed job.
- **Apply D1 migrations** or **Deploy** with
  `Authentication error [code: 10000]` — the `CLOUDFLARE_API_TOKEN` secret in
  the repository's `production` environment lacks a permission. It needs
  `Account · Workers Scripts · Edit`, `Account · D1 · Edit`,
  `Account · Workers R2 Storage · Edit`, and
  `Zone · Workers Routes · Edit`. (That environment also needs a
  `CLOUDFLARE_ACCOUNT_ID` **variable** — not a secret — which is easy to miss
  when recreating it, because nothing complains until a deploy runs.) This
  exact failure kept every deploy red for four days while the site quietly
  served a build from before the sharing surfaces existed, which is why the
  smoke test below exists.
- **Smoke test production** — the deploy uploaded something, but the live
  site isn't serving the routes this build defines. Do not retry blindly; see
  "Roll back" and read what the failing assertion actually checked.
- **Exercise the deployed editor and onboarding** — the expected bundle reached
  production, but its RTC editor interaction or onboarding walkthrough failed
  in headless Chrome. The Worker is already deployed, so fix forward or roll
  back.

## Managed GTFS archives

Production uses the `transitmapper-data` R2 bucket. The refresh workflow checks
for it and creates it through the Cloudflare API before it downloads a feed.
The `production` environment token needs `Account · Workers R2 Storage · Edit`.
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

The release workflow applies migrations before deploying code, so an ordinary
release needs nothing from you. To check what production is running:

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

## Not yet configured

Stated plainly so nobody assumes otherwise:

- **No alerting.** See above.
- **No staging environment.** `wrangler.toml` has no `[env.*]` blocks and no
  `preview_database_id`, so `wrangler dev --remote` runs your local code
  against the **production** D1, and a manual `pnpm run deploy` publishes
  straight to the live Worker. There is nowhere to rehearse a migration.
- **No error reporting service.** `console.error` in the Worker goes to the
  log stream and nowhere else.
