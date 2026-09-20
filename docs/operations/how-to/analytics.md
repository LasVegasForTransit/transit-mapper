# Operate TransitMapper analytics

TransitMapper uses the shared LVBT analytics package on
`map.lasvegasfortransit.org`. The Vite entry point initializes it in
`apps/web/src/analytics-entry.ts` before React renders.

Only the production deployment provides `PUBLIC_LVBT_CWA_TOKEN`, as a GitHub
Actions variable on the `production` environment. That workflow also sets
`LVBT_REQUIRE_ANALYTICS=1`, so a missing or blank token fails the build instead
of deploying an unmeasured production release. Local, pull request preview,
and retired archive builds omit both values and initialize no analytics.

The `/e/` embed prefix is fully excluded. The `/s/` share prefix suppresses
pageviews while leaving allowlisted analytics events available. Automatic SPA
pageviews remain enabled on allowed routes.

The static asset policy in `apps/web/public/_headers` permits only the shared
Cloudflare script, Cloudflare measurement endpoint, and LVBT event collector.
Worker-rendered share and embed responses set their own security headers.

Verify a preview or archive is absent:

```bash
pnpm exec lvbt-analytics verify "$URL" \
  --site map.lasvegasfortransit.org \
  --expect absent
```

Verify production after deployment:

```bash
pnpm exec lvbt-analytics verify https://map.lasvegasfortransit.org \
  --site map.lasvegasfortransit.org \
  --expect present
```

The analytics package's
[central privacy contract](https://github.com/LasVegasForTransit/analytics/blob/main/docs/security/reference/privacy-contract.md)
defines the shared restrictions. This integration adds no cookies, visitor
identifiers, fingerprints, IP retention, or user-agent retention, and it
honors Global Privacy Control and Do Not Track.
