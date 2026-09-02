# Pull request previews

Every push to an open pull request deploys the branch to a URL of its own, so
a reviewer can click the change instead of imagining it from a diff. This page
explains how that works and why it is built the way it is. To operate it —
reset the database, read a failed run — see
[operations](../../operations/how-to/operations.md#pull-request-previews).

## What happens on a push

The `Preview` workflow builds the branch, applies migrations, deploys a Worker
named `transitmapper-pr-<number>`, comments the URL, and then verifies the
deployed site. Closing the pull request deletes the Worker.

The URL is worked out before the build, not after the deploy. `VITE_SITE_URL`
is substituted into `index.html` at build time for the canonical link and the
Open Graph tags, so a hostname discovered later is a hostname the build already
got wrong. The workflow reads the account's `workers.dev` subdomain from the
Cloudflare API and assembles the address from that.

The comment is posted before verification rather than after. Its content
depends only on the deploy having succeeded, and the checks that follow take
several minutes. A preview that is up but serving something wrong is still the
one somebody needs the link to.

## Why a separate Worker per pull request

Cloudflare has a cheaper mechanism for this: `wrangler versions upload`
publishes a version of the _existing_ Worker and hands back a preview URL,
with no second Worker to manage or delete.

It is unavailable here. Cloudflare does not generate preview URLs for a Worker
that implements a Durable Object, and this one implements `PLACE_SEARCH_GATE`
to enforce Nominatim's one-request-per-second limit across every edge
location. So each preview is a Worker of its own, deployed from the
`[env.preview]` block of `apps/worker/wrangler.toml`.

That block restates every binding the production Worker declares, which looks
like copy-paste and is not optional. Wrangler treats `vars`, `d1_databases`,
`r2_buckets`, `durable_objects` and `ratelimits` as non-inheritable: an
environment that omits one is deployed without it, behind a warning nobody
reads. `scripts/tests/wrangler-preview-env.test.ts` compares the two blocks —
values included, not just binding names — so forgetting one fails `pnpm verify`
rather than producing a preview that breaks at runtime.

Two keys in that block work the other way and matter more than they look:

- `routes = []`. Routes _are_ inherited, and inheriting them is destructive.
  An environment that omits `routes` inherits the production custom domain and
  reassigns `map.lasvegasfortransit.org` to itself on every deploy. Wrangler
  warns and then does it anyway.
- `crons = []`. Triggers are inherited too. Without this, every open pull
  request would run the daily maintenance job against the shared database.

## Why one shared database

Every preview binds the same D1 database, `transitmapper-preview`.

Where a platform supports database branching — Neon, PlanetScale, Supabase —
a database per pull request is the better answer, and it is what most preview
systems reach for. D1 has no such primitive. A database per pull request would
mean creating and destroying an account resource from CI on every open and
close, with a leak every time teardown failed.

Sharing is safe here because migrations are append-only, which
[`check:migrations`](../reference/checks.md) enforces. An older branch keeps
working against a schema a newer branch has already extended. Nothing in the
database is worth keeping, so when an abandoned branch leaves it in a state
nobody wants, the fix is to recreate it.

The R2 bucket is shared with production on purpose. The Worker only ever reads
GTFS archives, so a preview cannot corrupt them, and a separate bucket would
need its own feed refresh before it held anything worth previewing against.

## Why forks get nothing

A preview builds the branch's own code and publishes it into this project's
Cloudflare account. GitHub withholds secrets from fork pull requests, which is
the correct default, and the workflow does not try to work around it. Fork
pull requests get a job that explains why instead of a failure nobody can act
on.

A fork gets a job summary rather than a comment, and that is a constraint
rather than a choice: a `pull_request` run from a fork carries a read-only
token, so the workflow cannot write a comment even to say why there is no
preview. Somebody has to open the run to read it.

That guard is the actual security boundary, and it is worth being blunt about
what it does and does not buy. Cloudflare has no per-script API token scope:
any token that can deploy a preview Worker can also overwrite the production
one. The separate `preview` GitHub Environment gives previews their own
deployment records and somewhere to put a narrower token the day Cloudflare
offers one. It is not isolation. What keeps the token away from unreviewed
code is that previews run only for branches pushed to this repository, and
pushing here already requires write access.

## When previews are not set up

A preview needs a `CLOUDFLARE_API_TOKEN` secret and a `CLOUDFLARE_ACCOUNT_ID`
variable on the `preview` GitHub environment, plus the shared database.
`pnpm bootstrap` creates all three, but until somebody runs it there is
nowhere to deploy to.

A `Preview configuration` job checks for the credentials first and the deploy
is skipped when they are missing, with the reason in the job summary. Failing
instead would put a red check on every pull request for a setup step that
cannot be done from a pull request, and a check that is always red is one
people learn to scroll past.

The check is for an _absent_ credential, not a rejected one. A token that
exists and does not work still fails the deploy, loudly, where it should.

## What the preview verifies

The same checks the production release runs, from the same composite action
(`.github/actions/verify-deployed-site`):

- `apps/web/scripts/deployment/deployed-http-smoke.ts` asserts the deployed
  origin is serving this build and answering its routes — that `/api` returns
  JSON, that a missing share is a 404 rather than the SPA shell, that preview
  images are images, that the embed prefix reaches Worker code.
- `apps/web/scripts/perf/live-production-smoke.ts` drives the editor and the
  onboarding walkthrough in real Chrome.

Sharing one action is deliberate. When those assertions lived inline in the
production workflow, adding a second caller meant copying them, and the copy
that drifts is the preview one — the copy that would have caught a regression
first.

## Staying out of search results

A preview URL is public, and it is posted as a comment on a public repository,
so search engines can reach it. Without anything in the way it would be indexed
as a duplicate of the live site, with unreleased work in it.

Most of the surface was already safe. Every page the Worker renders — share
pages, views, embeds, and the catch-all — goes through `withHtmlSecurityHeaders`,
which sends `X-Robots-Tag: noindex` on every origin. What that never touches is
the asset store: `run_worker_first` deliberately leaves `/`, `/privacy`,
`/robots.txt`, `/sitemap.xml` and `/assets/*` to Cloudflare, so no Worker code
runs for them and no header can be set there.

Cloudflare does not solve this for you. `*.workers.dev` is not automatically
de-indexed — that behaviour belongs to Pages preview deployments — and the
documented fix for Workers is the `_headers` file.

So `scripts/deployment/crawl-directives.ts` runs at the end of the build. When
the origin the build advertises is not production, it adds
`X-Robots-Tag: noindex` to the `/*` block of `_headers`, drops the `Sitemap:`
line from `robots.txt`, and deletes `sitemap.xml`. It reads that origin back out
of the built `index.html`'s canonical link rather than from an environment
variable, so the header can never disagree with the page.

Three decisions worth recording, because each has an appealing wrong answer:

- **A header, not `Disallow: /`.** `Disallow` stops a crawler fetching the page
  at all, and a page it cannot fetch is one whose `noindex` it never reads. This
  is the same reasoning `public/robots.txt` already records about share pages.
- **The canonical stays pointed at the preview.** Pointing it at production
  while also sending `noindex` is the one genuinely dangerous configuration:
  consolidating the two URLs can carry the `noindex` across to the target, which
  would let a throwaway pull request Worker de-index the live site.
- **Previews still unfurl.** Link preview bots do not honour `X-Robots-Tag`, and
  `Allow: /` stays, so a preview link pasted into Slack or the pull request still
  renders a card from its own `og:` tags. That is the intended outcome, not an
  oversight to be "fixed" later with a `Disallow`.

`deployed-http-smoke.ts` asserts the result against the origin it was pointed
at — production must stay indexable and keep its sitemap, anything else must
send `noindex` and have none — so a build that skipped the step is still caught
after it deploys.

## What the asset store publishes

`wrangler deploy --assets` uploads the whole of `dist/`, and the build writes
files there for its own use: Vite's manifest, which names every source module,
and the bundle and PWA reports. Those were being served publicly on production.

They cannot simply be deleted after the build, because five scripts read them
back. `dist/.assetsignore` is the mechanism for this — same format as
`.gitignore`, read by wrangler from the assets directory root — so the files
stay on disk for the tooling and in the release artifact, and never reach the
upload. `adaptive-assets.json` is not excluded: the service worker fetches it
at runtime.

The deployed smoke asserts `/.vite/manifest.json` is not served, because
`.assetsignore` is easy to lose in a build rewrite and nothing else would
notice.

## Known limits

- Two pull requests can race each other applying migrations to the shared
  database. The loser fails and succeeds on a re-run. A global lock would fix
  it; it has not been worth an extra job.
- Previews count against the account's Worker limit. Teardown keeps that
  bounded, and it fails loudly rather than silently when it cannot delete.
- Anonymous performance sampling never fires on a preview: it requires a
  release tag, and previews have none. The `SITE_URL` origin check that would
  otherwise reject those samples never comes up.
