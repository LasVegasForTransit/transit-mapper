# Pull request previews

Each same-repository pull request can deploy a public Worker named
`transitmapper-pr-<number>`. The thin `Preview` workflow calls the pinned shared
`release-pr-preview.yml` from repository-tooling. Fork pull requests cannot receive deployment
credentials. Closing a same-repository pull request deletes only its derived Worker.

## What happens on a push

The shared operation validates the pull request event, source commit, run identity, and reviewed
Workers account subdomain. It resolves the exact PR origin before building and passes that origin
as `VITE_SITE_URL`. TransitMapper already includes this variable in its build cache inputs, so
canonical and Open Graph links describe the preview rather than production.

The build runs the standard checks. The release producer reads both modes of the canonical
`apps/worker/cloudflare.config.ts`, freezes the compiled Worker, assets, deployment settings, and
SQL in a private artifact, and checks the inventory before publication. It clears preview routes
and cron, retargets the Durable Object binding to the PR Worker, applies the frozen SQL to the
reviewed preview database, and deploys those verified bytes. These private PR artifacts cannot be
promoted to production; production requires a separately retained and signed staging release.

The shared identity smoke verifies the selected Worker. TransitMapper's `release:acceptance`
extension then runs the existing HTTP assertions and real Chrome RTC editor and onboarding
walkthrough. The workflow updates a single bot comment after acceptance. Missing account or token
configuration skips publication with an explanation; an invalid supplied credential fails.

## Why a separate Worker per pull request

This Worker exports `PlaceSearchGate`, a Durable Object that coordinates Nominatim requests.
Version preview URLs are unavailable for Workers that export Durable Objects. A separate named
Worker preserves this runtime while giving each pull request its own Durable Object namespace.
The shared operation derives and validates the name, account, and origin before any deployment or
teardown. Production routes and scheduled triggers are never inherited by a PR Worker.

## Shared preview resources

Every preview uses the reviewed `transitmapper-preview` D1 database. The explicit
`LVBT_PREVIEW_BINDINGS` declaration must supply its real ID; the local placeholder is not accepted
for publication. The producer checks that preview and production database IDs differ. Closing a
pull request does not delete this shared database or its rows.

Migrations remain append-only, as [`check:migrations`](../reference/checks.md) requires. Frozen SQL
runs before candidate HTTP or browser checks, so code never starts acceptance against a missing
new column. Older previews must remain compatible with additive schema changes. Concurrent pull
requests can still contend while applying migrations to the shared database; reconcile a failed
run before repeating it.

The public GTFS archive R2 bucket is intentionally shared. The declaration explicitly marks
`GTFS_ARCHIVES` read-only. The shared producer checks compiled modules against its supported
handler contract, and the generated preview wrapper supplies a detached `get`/`head`/`list`
facade. This contract excludes native global binding access and is not a sandbox for arbitrary
unreviewed code. Preview rate-limit namespaces are distinct from production.

## Credentials and setup

The `preview` GitHub environment retains the existing `CLOUDFLARE_API_TOKEN` secret and
`CLOUDFLARE_ACCOUNT_ID` variable. A maintainer must also supply the reviewed preview bindings.
[Production setup](../../operations/how-to/set-up-production.md) describes these declarations.
Basic development and local validation do not require Cloudflare credentials.

PR previews preserve the existing public policy. The shared workflow provides no Access service
credentials to public preview acceptance. The separately retained staging Worker is protected by
Access and uses credentials confined to its approved origin. No preview credentials are passed
to the production activation job.

A fork gets no deploy or teardown job. The workflow never uses `pull_request_target` to execute
branch code with privileged credentials. Same-repository branch publication still runs code from
a contributor with repository write access; the selected token's provider permissions remain a
maintainer-controlled boundary.

## Product acceptance

`apps/web/scripts/deployment/deployed-http-smoke.ts` checks the live build, JSON API responses,
missing-share 404s, image types, embeds, CSP, HSTS, crawl policy, and the asset entrypoint.
`apps/web/scripts/perf/live-production-smoke.ts` drives the RTC editor and onboarding in real
Chrome. Both staging, promotion, and PR publication call the same thin `release:acceptance`
extension, while the shared release engine owns packaging, migrations, publication, identity,
credential isolation, and teardown.

Preview pages send `noindex`; preview robots omit the sitemap, and `/sitemap.xml` is absent. The
preview Worker handles the relevant HTML and crawl paths even when the assets were built for
production. The release marker also reaches the wrapper, which applies private, no-store cache
policy and verifies its source identity. Production remains indexable.

## Published assets and limits

`dist/.assetsignore` excludes Vite manifests and build reports from public upload while retaining
those files for tooling. `adaptive-assets.json` remains public because the service worker needs
it. HTTP acceptance checks that `/.vite/manifest.json` is unavailable.

PR Workers count against the account limit. Teardown accepts an already absent Worker, but fails
on other provider errors. It removes the PR Worker and its Durable Object namespace, without
modifying D1 or R2 resources. Performance samples remain disabled on PR previews because they have
no published release tag.
