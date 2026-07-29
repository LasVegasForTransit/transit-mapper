# Working in this repository

What this project is and how it is laid out lives in [`docs/`](docs/README.md).
The reasoning behind the domain model is in
[Design principles](docs/product/explanation/design-principles.md).

## The bar

```bash
pnpm check
```

The command runs formatting, lint, typecheck, tests, and the repository's
own invariants. It requires no browser and no network.

```bash
pnpm check --fix
```

The `--fix` form repairs everything a machine can. A failing check names
the command that resolves it.

If new logic can only be checked by clicking through the app, move it down
into `packages/core` where the test suite can reach it.

Why it is shaped this way, and what the four enforcement layers are:
[the enforcement model](docs/development/explanation/enforcement-model.md).

## Invariants

Most of these are enforced. Where the right-hand column says a command, you
do not need to carry the rule — break it and the command tells you. Where it
says **nothing**, the rule holds only because you follow it.

| Invariant                                                                       | Why it exists                                                                                                            | Enforced by                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `packages/core` uses no browser-only globals                                    | core is typechecked against the browser _and_ workerd; a browser global compiles and then throws in production           | `lint`                          |
| A migration that exists is never edited, renamed, or deleted                    | Wrangler records applied migrations by name and never re-runs one it has seen, so an edit silently diverges environments | `check:migrations`              |
| Every package declares `lint`, `typecheck`, `verify`                            | a package missing one is skipped by Turborepo without an error, and CI stays green while it goes unchecked               | `check:contract`                |
| Every dependency version comes from the catalog                                 | two packages on different versions of one library is invisible until it breaks                                           | `check:contract`                |
| Recognizable test material lives under the owning module's root `tests/` tree   | Production trees stay navigable, and runner globs cannot silently omit a colocated test                                  | `check:contract`                |
| Test-only support lives under the owning module's root `tests/support/` tree    | A generic `support/` directory has no test-specific signal, so this semantic boundary depends on contributors            | **nothing**                     |
| Relative links in `docs/` resolve                                               | three had been broken since the monorepo split, and nothing noticed                                                      | `check:docs`                    |
| `worker-configuration.d.ts` matches `wrangler.toml`                             | it is generated and committed, so it can describe a deployment that no longer exists                                     | `check:types`                   |
| Commit subjects are conventional, ≤72 chars                                     | see [commit messages](docs/development/reference/commit-messages.md)                                                     | `commit-msg` hook               |
| No secret reaches a commit                                                      | see [secrets](docs/security/reference/secrets.md)                                                                        | pre-commit, CI, push protection |
| Stored values are injected with `HTMLRewriter`, never string concatenation      | `system.name` is unauthenticated text with no sanitization at write time                                                 | **nothing** — see below         |
| `/api` paths name a resource; the verb is the HTTP method                       | `DELETE /api/session`, not `POST /api/auth/signout`                                                                      | **nothing**                     |
| Parameter and prop types are named interfaces, even single-use ones             | `interface ShareDialogProps { onClose: () => void }`, not an inline object type                                          | **nothing**                     |
| New module and asset filenames use kebab-case unless tooling requires otherwise | One predictable convention keeps imports and generated artifacts easy to find                                            | **nothing**                     |
| Selection-dependent controls go in the right-hand inspector                     | one dynamic surface, not several                                                                                         | **nothing**                     |

The `HTMLRewriter` row is unenforced by choice. The two places the Worker builds markup by interpolation are both
correct, and telling a safe interpolation from an unsafe one needs value
provenance a linter does not have — so a rule there would report only false
positives, which teaches people to disable rules.

## Document the change as part of the change

Write for a maintainer who does not have the context that produced the
change. Contributors range from first-timers to transit advocates who write
some TypeScript.

**Architecture first.** When a change adds a subsystem, introduces a table,
adds a request path through the Worker, or changes how existing pieces
communicate, write down how it works and why, and record where it lives in
[Project structure](docs/development/reference/project-structure.md). Do this for the
pieces with no visible UI too — schema, sessions, routing, background jobs,
and the boundaries between `packages/core`, `apps/web`, and `apps/worker`.
Do not leave a subsystem whose design can only be recovered by reading every
file that touches it.

Then, in the same change:

- Update any `docs/` guide whose described behaviour the change alters.
- Comment _why_ the code is the way it is — the constraint, trade-off, or
  failure it avoids. The code already says what it does.
  `apps/worker/src/index.ts` shows the expected density.
- Explain every schema column, cookie attribute, cron trigger, environment
  variable, and security-relevant choice where it is defined.

## Add a test

Tests run on Vitest and on a `check()`-based suite that predates it.
`pnpm verify` runs both.

- `apps/web/tests/verify.test.ts` and `apps/worker/tests/verify.test.ts` are
  sequential scripts: one store is built at module scope and mutated in
  order, so each section depends on what the sections above it left behind.
  Add to them in that style, beside related cases. Do not split them up
  piecemeal.
- New isolated Vitest files go under `<module>/tests/`, mirroring the area in
  `src/` they cover. `apps/worker/tests/shares.test.ts` runs in real workerd
  against a real D1 with the production migrations applied.
- Every file under `tests/` uses `.test.ts` or `.test.tsx`, including
  sequential verifiers and support modules. End-to-end files under
  `<module>/tests/e2e/` use `.spec.ts` or `.spec.tsx`.

Name a case as a sentence stating the rule it enforces — "deleting a way
removes its service" — because that name is what a failure reports.

## Add a migration

Write a new `.sql` file in `apps/worker/src/migrations/`; Wrangler applies
them in filename order. Never touch one that already exists.

Before giving a column new meaning, check what it already encodes. A null
`expires_at` on `systems` means "never expires" — a defined value, not
unset — reserved so account-owned shares can be permanent without a
migration.

For anonymous data during a schema change, follow `0002` and delete it
rather than writing a complicated backfill.

Deploying, rolling back, and restoring the database:
[operations](docs/operations/how-to/operations.md).

## Keep `packages/core` runnable in both runtimes

Core is typechecked standalone against the browser and the Workers runtime.
Its tsconfig includes the `DOM` lib only to pick up ambient `fetch`,
`crypto`, and `structuredClone`, which both runtimes provide. That
inclusion also admits the browser-only globals, and the lint rule rejects
those.

## Agent configuration

`.claude/` holds Claude-specific mechanism only: a hook that formats after an
edit, and denied reads on secret-bearing paths. It introduces no rule that
exists nowhere else. Delete the directory entirely and `pnpm check` accepts
the same trees — CI proves that on every pull request, because CI has no
agent. See [`.claude/README.md`](.claude/README.md).
