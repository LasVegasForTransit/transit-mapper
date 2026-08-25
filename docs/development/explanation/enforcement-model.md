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

The command is one Turborepo graph. Package checks and repository-root checks
run at the scheduler's native concurrency; dependencies in `turbo.json`, not a
serial shell chain, determine ordering.

Package checks and root checks that discover files use Turborepo's default
input set so every tracked module input is covered while ignored dependencies,
build output, and cache files do not invalidate them. Cross-package executable
inputs are explicit: TypeScript and test tasks hash the shared TypeScript
configuration, and lint tasks hash both the root config and the repository's
local ESLint plugin. The migration check is deliberately uncached because its
result also depends on the current Git merge base, not only on file contents.

Runtime packages use `tsc -p tsconfig.build.json` and declare `dist/**` as the
existing Turbo build task's output. Workspace dependencies create the graph;
`build` already depends on `^build`, so the repository has no second package
builder or cache wrapper. Package exports select source under the development
condition and emitted JavaScript and declarations otherwise. A clean
production build therefore checks the same package artifacts that deployment
consumes, while Vite development needs no package watcher.

## Layers

| Layer          | What runs                                          | Blocks on                   |
| -------------- | -------------------------------------------------- | --------------------------- |
| 0 — agent      | shared creation guard and format-on-edit hook      | action mistakes             |
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

That protection is scoped to `main` on purpose. Amending your own commits,
force-pushing your own branch, rebasing onto a moved base — all of that is
normal work on a feature branch, and nothing here restricts it. The rule
is that `main` itself never gets deleted or force-pushed, not that history
is sacred everywhere.

### Merge method

Pull requests land by rebase or squash merge. Merge commits are off, so
`main` remains a straight line. Use rebase when the branch already tells a
useful sequence; use squash when its intermediate commits are only working
history.

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

Creating a GitHub item is another action with no repository artifact. The
pinned LVBT plugin therefore blocks direct creation in Codex and Claude and
routes agents through the same readable structure humans receive from
GitHub. `check:repository-tooling` verifies the pinned files and wiring, but
GitHub does not police issue or pull request prose after creation.

The durable rules remain testable without an agent process. CI does not run
either harness, but `check:repository-tooling` verifies that their generated
adapters still point at the same pinned plugin release and that the portable
rule remains declared in `AGENTS.md`.

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

### config-shape

`check:config` gives every tool one place and one format: `<tool>.config.<ext>`
at the root of whatever it configures, where `<ext>` is `ts` unless the tool
cannot load TypeScript.

The repository reached that shape on its own — `vite.config.ts`, five
`vitest.config.ts`, `perf.config.ts`, `turbo/generators/config.ts` — and then
drifted, because nothing said so. `eslint.config.js` stayed JavaScript while
everything around it became TypeScript, and Prettier kept the `.prettierrc.json`
name it was born with. Neither was a decision. Both were what the tool's
quickstart printed.

That is the failure the check prevents. Every new tool arrives with its own
default filename and its own preferred format, and a repository that accepts
each default ends up with a root nobody can predict. Somebody looking for a
setting has to know the tool before they can find the file.

Three rules do it. A `.toolrc` name is rejected, because it carries no extension
an editor can use. A `<tool>.config.<ext>` file must be TypeScript unless the
tool appears in `NOT_TYPESCRIPT` with the reason it cannot be. Any other JSON,
YAML, or TOML file sitting at a module root must appear in `OWNED_PATHS`, which
holds the names their own tools define and nobody can rename — `package.json`,
`turbo.json`, `wrangler.toml`, `pnpm-workspace.yaml`.

**If it fires:** rename the file to the displayed shape. If the tool cannot read
any other name or cannot load TypeScript, add it to the matching list in
`scripts/check-config.ts` together with the reason, so the exemption is a
decision somebody made rather than a default nobody questioned.

**It will not fire** on a data file deeper in a tree. Only the immediate
children of a module root are configuration; a `.json` under `src/` or
`public/` is content or a fixture.

### lint-debt

Turning on a rule that reports a thousand findings has two bad answers. Fix
them all first, and the rule lands in six months or never. Set the rule to
warn, and it reports forever while nothing changes.

The third answer is a ledger. `eslint --suppress-all` records a count per file
per rule, so existing findings stop failing the build and the rule binds on
everything new. ESLint reads that ledger from the working directory, and every
package lints from its own, so each package carries its own —
`apps/web/eslint-suppressions.json` and three others. There is no shared file
for two branches to conflict over.

ESLint enforces one half by itself: grow a count and it reports every violation
in that file rather than only the new one, so the pressure lands on the file
instead of the counter.

Reading the ledger from the working directory is also why ESLint does not run
at layer 1. `lint-staged` runs from the repository root, where it would see
none of them and report every frozen finding as a fresh failure.

`check:debt` enforces the other half, against the Git merge base. The ledger
may not grow — no file gains an entry, no count rises, and a ledger that
existed on the base branch may not disappear. And a changed file that carries
entries has to come out strictly better: fewer suppressed findings, or fewer
lines.

That second rule is what stops a 4,000-line file being edited around forever.
It is gameable by deleting a blank line, which is accepted: the point is to put
the debt in front of whoever opened the file, not to make it impossible to walk
past.

A ledger that does not exist on the base branch is reported and allowed,
because the branch that turns a rule on is the one branch where every entry is
new by construction. Deleting a ledger to reach that state again fails.

**If it fires:** fix the finding rather than recording it. If you removed one,
run `eslint --prune-suppressions` so the count matches. If you edited a file
that carries debt, take some of it with you.

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
