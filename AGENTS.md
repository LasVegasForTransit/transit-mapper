# Working in this repository

How to make changes here. What the project is and how it's laid out is in
[`docs/`](docs/README.md); the reasoning behind the domain model is in
[Design principles](docs/explanation/design-principles.md).

## Document the change as part of the change

Write for a maintainer without the context that produced the change.
Contributors range from first-time contributors to transit advocates who
write some TypeScript.

**Document system architecture first.** When a change adds a subsystem,
introduces a data store or table, adds a request path through the Worker, or
changes how existing pieces communicate, write how it works and why into
`docs/explanation/`, and record where it lives in
[Project structure](docs/reference/project-structure.md). Do this for the
pieces with no visible UI too — schema, session handling, request routing,
background jobs, and the boundaries between `packages/core`, `apps/web`, and
`apps/worker`. Don't leave a subsystem whose design can only be recovered by
reading every file that touches it.

Then, in the same change:

- Update any `docs/` guide whose described behavior the change alters.
- Comment why the code is the way it is — the constraint, trade-off, or
  failure it avoids. The code already states what it does.
  `apps/worker/src/index.ts` and `apps/web/src/storage/localStore.ts` show
  the expected density.
- Explain every schema column, cookie attribute, cron trigger, environment
  variable, and security-relevant choice where it is defined.

## Verify before opening a pull request

```bash
pnpm typecheck && pnpm verify
```

Both must pass, and both run without a browser or network. If new logic can
only be checked by clicking through the app, move it down into
`packages/core` where `verify` can reach it.

## Add a test by adding a `check()` call

Put it in `apps/web/scripts/verify.ts`, next to related checks. There is no
test framework here — no `describe`/`it`, assertion library, watch mode, or
discovery. Name the check as a sentence stating the rule it enforces
("deleting a way removes its service"); that name is the entire failure
message.

## Name a new package's scripts to match the turbo tasks

Use `build`, `typecheck`, and `verify`, matching the task names in
`turbo.json`. A package whose script has a different name is skipped without
an error, and CI still passes.

## Keep `packages/core` runnable in both runtimes

Core is type-checked standalone against the browser and the Workers runtime,
so don't reach for `window`, `document`, or `localStorage` there. Its
tsconfig includes the `DOM` lib only to pick up ambient `fetch`, `crypto`,
and `structuredClone` typings that both runtimes provide.

## Add a migration as a new file

Write a new `.sql` file in `apps/worker/src/migrations/`; Wrangler applies
them in filename order. Never edit a migration that has already run in
production.

Before giving a column new meaning, check what it already encodes. A null
`expires_at` on `systems` means "never expires" — a defined value, not unset
— reserved so account-owned shares can be permanent without a migration.

For anonymous data during a schema change, follow `0002` and delete it rather
than writing a complicated backfill.

## Add routes under `/api` as REST resources

Name the path after a resource and put the action in the HTTP method:
`DELETE /api/session`, not `POST /api/auth/signout`. Filter collections with
query parameters — `GET /api/systems?owner=me` — rather than adding a
sub-path like `/api/systems/mine`. Model an action as a state change on a
resource or sub-resource; if it can't be expressed that way, the resource
model needs rethinking rather than an RPC endpoint.

Endpoints that exist for browser navigation rather than for API clients —
ones that return a redirect and set cookies, such as an OAuth start and
callback — are mounted outside `/api`.

## Render stored values with `HTMLRewriter`, never string concatenation

Values like `system.name` are unauthenticated user-supplied text with no
sanitization at write time. Inject them into the SPA shell with
`HTMLRewriter`'s element API, which escapes for the surrounding context.

When adding a route that both reads the database and serves an asset, fetch
the asset before the lookup, so a miss returns the same response as the
catch-all route and existing 404 and SPA-fallback behavior is unchanged.

## Follow local conventions

- Declare parameter and prop types as named interfaces, including single-use
  ones: `interface ShareDialogProps { onClose: () => void }`, not an inline
  object type.
- Put selection-dependent controls in the right-hand inspector. Don't add a
  second dynamic panel elsewhere.
- Write prose that is concrete rather than abstract and states current
  capability accurately. Label planned work as planned.
