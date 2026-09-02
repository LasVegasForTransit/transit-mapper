# Add a package

```bash
pnpm gen package
pnpm install
pnpm check
```

The generator asks for a name and a one-line purpose, and emits a package that already passes every
check: the three required scripts, a Vitest project, a tsconfig leaf, and a placeholder test so
`verify` has something to run. The generated test lives under `tests/`, beside the production `src/`
tree rather than inside it.

## What the generator is saving you from

`lvbt check contract` requires every package to declare `lint`, `check-types` and `test`. That is
not bureaucracy — a package missing one is skipped by Turborepo **without an error**, so CI passes
while the package goes unchecked. That is how `apps/worker` reached production with no tests at all
and nothing reporting it.

It also requires every dependency to say `catalog:` rather than a literal range, so two packages
cannot drift onto different versions of one library without that showing up as a change to
`pnpm-workspace.yaml`.

## Adding a dependency

Add the version to the `catalog:` block in `pnpm-workspace.yaml`, then reference it:

```json
"dependencies": { "some-library": "catalog:" }
```

Take the newest version every other tool in the repository supports, not the newest published.
`typescript` is pinned and Renovate is configured not to touch it, because typescript-eslint cannot
load under TypeScript 7 — a bump there silently disables linting.

## The tsconfig

The generated one is a standalone leaf with its own `noEmit`. Do not add `composite` or
`references`: `tsc -b --noEmit` raises TS6310 as soon as a project has outgoing references, which
this repository has hit before.

## Then write it down

`check:structure` fails if a new source directory has no section in
[project structure](../../development/reference/project-structure.md). Adding one is part of adding
the package, not a follow-up.
