# Run TransitMapper in production

Everything here needs access to the Las Vegas for Better Transit Cloudflare
account. If you don't have it, the person who does is the one who can act on
any of this.

Production is one Cloudflare Worker (`transitmapper`) on
`map.lasvegasfortransit.org`, serving the built SPA as static assets and
handling `/api/*`, `/s/*` and `/e/*` itself, with one D1 database (also
`transitmapper`) holding shared systems.

## Deploy

Deploys are automatic: pushing to `main` runs
[`deploy-production.yml`](../../../.github/workflows/deploy-production.yml),
which runs the full CI checks, builds, applies any pending D1 migrations,
deploys the Worker, and then smoke-tests the live site.

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

Check which step failed before anything else — the three fail for unrelated
reasons.

- **Validate** — a real test or type failure. Fix it on a branch.
- **Apply D1 migrations** or **Deploy** with
  `Authentication error [code: 10000]` — the `CLOUDFLARE_API_TOKEN` secret in
  the repository's `production` environment lacks a permission. It needs
  `Account · Workers Scripts · Edit`, `Account · D1 · Edit`, and
  `Zone · Workers Routes · Edit`. (That environment also needs a
  `CLOUDFLARE_ACCOUNT_ID` **variable** — not a secret — which is easy to miss
  when recreating it, because nothing complains until a deploy runs.) This
  exact failure kept every deploy red for four days while the site quietly
  served a build from before the sharing surfaces existed, which is why the
  smoke test below exists.
- **Smoke test production** — the deploy uploaded something, but the live
  site isn't serving the routes this build defines. Do not retry blindly; see
  "Roll back" and read what the failing assertion actually checked.

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

## Apply and check migrations

The deploy workflow applies migrations before deploying code, so an ordinary
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

## Restore the database

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

## When something breaks in production

Worker logs are on at 100% sampling:

```bash
pnpm --filter @transitmapper/worker exec wrangler tail
```

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

## What isn't set up yet

Stated plainly so nobody assumes otherwise:

- **No alerting.** See above.
- **No staging environment.** `wrangler.toml` has no `[env.*]` blocks and no
  `preview_database_id`, so `wrangler dev --remote` runs your local code
  against the **production** D1, and a manual `pnpm run deploy` publishes
  straight to the live Worker. There is nowhere to rehearse a migration.
- **No error reporting service.** `console.error` in the Worker goes to the
  log stream and nowhere else.
