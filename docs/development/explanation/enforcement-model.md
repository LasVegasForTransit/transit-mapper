# How this repository enforces its own rules

This page explains why each check exists, for someone a check has just
stopped.

## Purpose

This repository used to state about a dozen rules in `AGENTS.md` — use
named interfaces, keep `packages/core` runtime-pure, never edit an applied
migration, keep `/api` REST-shaped — and a command failed on exactly one of
them. The rest held for as long as somebody remembered them.

That is not a documentation problem. A rule nothing executes is a
suggestion, and suggestions decay silently: nothing announces the day one
stops being followed.

So the work is converting rules into commands that fail.

## Bar

```bash
pnpm check
```

Formatting, lint, typecheck, tests, the workspace contract, and the
generated-types staleness check. That is the entire bar. `pnpm check --fix`
repairs everything a machine can.

One command means a red CI run maps to one local command. The output names
the tool that failed and the command that resolves it.

## Layers

| Layer          | What runs                                          | Blocks on                   |
| -------------- | -------------------------------------------------- | --------------------------- |
| 0 — agent      | format-on-edit hook in `.claude/`                  | nothing                     |
| 1 — pre-commit | `lint-staged`, staged filename validation, secrets | nothing a machine can fix   |
| 2 — pre-push   | `pnpm check`                                       | everything                  |
| 3 — CI         | `pnpm check`, plus a full secret scan              | everything, authoritatively |
| 4 — the branch | a GitHub ruleset on the default branch             | a merge that skipped CI     |

Layers 0 to 2 are conveniences and they are bypassable on purpose.
`--no-verify` exists, and a hook that is slow or that scolds gets bypassed
— at which point it enforces nothing at all. Making them unbypassable
would train people to work around them.

**Layer 3 is the guarantee.** Nothing merges red.

Layer 4 is what makes that sentence true. CI reporting a failure stops
nothing on its own; the ruleset is what refuses the merge. It requires a
pull request, requires the `Validate` check to pass, and forbids deleting
or force-pushing the branch. `scripts/bootstrap/standards.ts` holds it as
data, and `pnpm bootstrap` reports drift or applies it.

### Required approvals

The ruleset asks for zero approving reviews, which is deliberate and
temporary. Nobody can approve their own pull request, so on a repository
with one collaborator a required approval blocks every merge, including
the one that would relax the requirement. Zero keeps the two rules that
work without a second person: a change arrives as a pull request, and it
does not merge until `Validate` passes. The count goes to 1 when a second
maintainer exists.

## Placement

> Repository tooling checks artifacts. Agent configuration constrains
> actions.

If a human doing the same thing would be caught by `pnpm check`, the rule
belongs in repository tooling — always. Agent configuration is only for
cases where the harm happens before any artifact exists, so there is
nothing for a check to inspect.

`packages/core` importing `document` leaves an artifact, so it is a lint
rule. Reading `.dev.vars` leaves no trace in the repository, so no check
can ever see it, and it is a denied read in `.claude/settings.json`.

The test: delete `.claude/` and `pnpm check` must accept exactly the same
trees. CI proves this on every pull request for free, because CI has no
agent configuration at all.

## Rules

### file-names

`check:filenames` gives module source and test trees one exact grammar. A file
under `<module>/src/` has one stem and one extension, such as `store.ts`,
`App.tsx`, or `0001_init.sql`. A file under `<module>/tests/` has exactly the
form `<name>.test.ts` or `<name>.test.tsx`. End-to-end files under
`tests/e2e/` use `<name>.spec.ts` or `<name>.spec.tsx`; `spec` is rejected
outside that tree, and `test` is rejected inside it.

The normal command reads tracked and non-ignored untracked files from Git so
new files fail before they are added. Pre-commit runs the same validator with
`--staged`, checking the exact index rather than unrelated working-tree edits.

**If it fires:** rename the file to the displayed shape and update its imports.

### test-layout

Vitest globs alone cannot enforce the test boundary: a test placed elsewhere
is silently skipped. `check:contract` already knows each workspace package
and its `verify` script, so it also checks the paths those scripts and test
runners use.

It rejects test and spec filenames, conventional test directories named
`test`, `tests`, `testing`, or `__tests__`, and direct `tsx` verifier entries
outside the owning package's `tests/` tree. A generic `support/` directory
does not identify its contents as test-only, so contributors keep semantic
test support under `tests/support/` as a human rule.

**If it fires:** move the path under `<package>/tests/`, mirroring the source
area it covers, and update imports to cross explicitly into `src/`.

`check:filenames` independently validates every filename in the module trees
before `check:contract` validates test placement and package ownership.

### core-runtime-purity

`packages/core` runs in two runtimes: the browser and workerd. A
browser-only global compiles cleanly and then throws in production, in
whichever runtime nobody exercised.

The compiler cannot catch this. Core's tsconfig includes the `DOM` lib to
obtain the ambient `fetch`, `crypto`, and `structuredClone` typings that
both runtimes provide, and that inclusion also admits `window` and
`document`.

**If it fires:** move the code that needs the global into `apps/web`, or
pass the value in as an argument so core stays a pure function of its
input.

**It will not fire** on a local variable that shares the name, on an object
property called `document`, or on member access like `o.window`. The rule
uses scope analysis and only reports references that resolve to nothing —
which is what "a global" means.

## Adding a rule

A rule needs three things, and the check enforces the third:

1. The rule itself, in `packages/eslint-plugin/src/`.
2. Tests, covering a violation **and** the near-miss cases that must not
   fire. False positives are worse than a missing rule: they teach people
   to reach for `eslint-disable`.
3. A `meta.docs.url` pointing at a real section of this page.

Register it in `packages/eslint-plugin/src/index.ts` and scope it in
`eslint.config.js` to the package it is about.
