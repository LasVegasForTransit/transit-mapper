# Run the checks

```bash
pnpm check
```

That is the whole bar. Formatting, lint, typecheck, the test suites, and
the repository's own invariants. It needs no browser and no network, and it
is exactly what CI runs — so a green run locally means a green run there.

```bash
pnpm check --fix
```

repairs everything a machine can, then re-runs the rest.

## What each part is for

| Command             | Fails when                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `format:check`      | a file is not Prettier-formatted                                                                                   |
| `lint`              | a lint rule is violated, including the repository's own                                                            |
| `typecheck:scripts` | a script under `scripts/` does not compile                                                                         |
| `check:contract`    | a package is missing a required task, pins a version outside the catalog, or keeps tests outside its `tests/` tree |
| `check:docs`        | a relative link in `docs/` does not resolve                                                                        |
| `check:migrations`  | a migration that already exists was edited, renamed or deleted                                                     |
| `check:structure`   | a source directory is undescribed, or a described one is gone                                                      |
| `check:types`       | `worker-configuration.d.ts` no longer matches `wrangler.toml`                                                      |
| `verify`            | a test fails                                                                                                       |

Every failure names the command that fixes it. If one does not, that is a
bug in the check worth reporting.

## When it fails and you disagree

Do not reach for `eslint-disable` as the first move. A rule firing on
correct code is a defect in the rule, and the fix is to narrow the rule so
the next person does not hit it too. If a suppression really is right, put
the reason on the line above it — `packages/core/src/auth/returnTo.ts` shows
the shape.

## Running less than everything

```bash
pnpm --filter @transitmapper/core verify     # one package's tests
pnpm --filter @transitmapper/web typecheck   # one package's types
pnpm lint                                     # lint alone, whole repo
```

Turborepo caches by content, so a repeat run with nothing changed replays in
milliseconds rather than re-running anything.

## The layers underneath

`pnpm check` is layer 3 of four. A commit auto-formats what you staged; a
push runs the whole bar; CI runs it again and is the one that decides. Why
it is built that way is in
[the enforcement model](../explanation/enforcement-model.md).
