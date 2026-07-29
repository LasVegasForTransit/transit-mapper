# Add a migration

```bash
pnpm gen migration
```

The generator numbers it from the migrations already present and writes the
header. Wrangler applies them in filename order.

## The rule that matters

**A migration that exists is never edited, renamed, or deleted.**
`check:migrations` enforces it and will fail the build.

The reason it is absolute: Wrangler records applied migrations _by name_ and
never re-runs one it has seen. Edit a file it already applied and the change
runs on nothing that exists and in full on anything created later. The
environments diverge permanently, the deploy is green, and it surfaces
whenever a query reaches a column that exists in one place and not the
other.

Renaming counts. It looks like tidying up and is indistinguishable from a
delete as far as the ledger is concerned.

Got it wrong? Restore the file and add a new migration with the change.

## Write it to be safe against the running Worker

A deploy is not atomic, and a rollback does not un-migrate. The migration
applies before the new code is serving, and if that code is rolled back you
are left with the new schema and the old Worker.

So migrations are additive. Add a column; do not drop or rename one in the
same change that starts using it. Removal is a later, separate migration,
once nothing deployed refers to the old shape.

## Before giving a column new meaning

Check what it already encodes. A null `expires_at` on `systems` means
"never expires" — a defined value, not unset — reserved so account-owned
shares can be permanent without a migration.

For anonymous data during a schema change, follow `0002` and delete it
rather than writing a complicated backfill.

## Applying it

Locally:

```bash
pnpm --filter @transitmapper/worker exec wrangler d1 migrations apply transitmapper --local
```

In production the deploy pipeline applies migrations before the Worker
deploys. See [operations](../../operations/how-to/operations.md).

Tests apply them too: `apps/worker/tests/shares.test.ts` runs against a real
D1 built from these exact files, so a migration that does not apply cleanly
fails the suite.
