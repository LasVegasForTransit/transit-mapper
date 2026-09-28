# Run the checks

```bash
pnpm check
```

That is the whole bar. Formatting, lint, typecheck, the test suites, and
the repository's own invariants. It needs no browser and no network, and it
is exactly what CI runs — so a green run locally means a green run there.

```bash
pnpm check:fix
```

repairs everything a machine can: formatting, Markdown, and lint fixes.

## What each part is for

`pnpm check` has two halves. The first is the organization's, identical in
every LVBT repository: Prettier, markdownlint (which also resolves every
relative link and anchor), `lvbt check` (filenames, the workspace contract,
lint debt, and platform manifests), then lint, type checking, and tests in
every package. The second is this repository's own: the `validate` task in
`turbo.json`, which runs the checks only TransitMapper needs, such as
migrations staying append-only and the project map staying accurate.

[The checks reference](../reference/checks.md) lists every check, what makes
it fail, and what fixes it. Every failure names the command that fixes it.
If one does not, that is a bug in the check worth reporting.

## When it fails and you disagree

Do not reach for `eslint-disable` as the first move. A rule firing on
correct code is a defect in the rule, and the fix is to narrow the rule so
the next person does not hit it too. If a suppression really is right, put
the reason on the line above it — `packages/core/src/auth/returnTo.ts` shows
the shape.

## Running less than everything

```bash
pnpm --filter @transitmapper/core test          # one package's tests
pnpm --filter @transitmapper/web check-types    # one package's types
pnpm lint                                        # lint alone, every package
```

Turborepo caches by content, so a repeat run with nothing changed replays in
milliseconds rather than re-running anything.

## The layers underneath

`pnpm check` is layer 3 of four. A commit auto-formats what you staged; a
push runs the whole bar; CI runs it again and is the one that decides. Why
it is built that way is in
[the enforcement model](../explanation/enforcement-model.md).
