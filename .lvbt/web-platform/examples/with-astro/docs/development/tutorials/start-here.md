# Start here

This tutorial takes you from a fresh clone to a passing check and a first commit. It exists so that
your first hour is spent on the project, not on tooling. You need to be able to run a command in a
terminal; nothing else is assumed.

## Before you start

- Node.js 24.20 or newer on the 24 line (the current long-term support release). Check with
  `node --version`; install from [nodejs.org](https://nodejs.org) if needed.
- git, and a GitHub account with access to this repository.
- The GitHub CLI (`gh`), signed in with `gh auth login`. Issues and pull requests are created
  through it.

pnpm (the package manager, see the [glossary](../reference/glossary.md#pnpm)) installs itself from
the version pinned in `package.json` the first time you run it, through Corepack. If
`pnpm --version` fails, run `corepack enable` once.

## 1. Clone and bootstrap

```bash
git clone git@github.com:LasVegasForTransit/<this-repository>.git
cd <this-repository>
pnpm bootstrap
```

`bootstrap` installs dependencies, points git at the repository's hooks, and runs preflight, which
prints one line per check:

```text
  ok    Node.js        24.20.0 satisfies ^24.20.0
  ok    pnpm           11.25.0 matches packageManager
  ok    dependencies   node_modules is present
  ok    git hooks      core.hooksPath is .githooks
  ok    commit scopes  .lvbt/commit-scopes.txt is present
  ok    GitHub CLI     gh is installed and signed in
  ok    Cloudflare     wrangler is signed in; deployables: apps/site
preflight: all 7 checks passed
```

A failing line prints the command that fixes it. Run it, then `pnpm preflight` again.

## 2. Run the check

```bash
pnpm check
```

This is the same command CI runs: formatting, documentation links, the repository-shape rules, then
lint, typecheck, and tests for every package. On a fresh clone it passes. When it fails, the output
names the package and file; `pnpm check:fix` repairs everything a machine can (formatting and
auto-fixable lint findings).

## 3. Make a change and commit it

Edit a file, then:

```bash
git add <the file>
git commit
```

The commit hook checks the message. Subjects look like `type(scope): description` where `type` is
one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `style`, `revert`,
and the optional `scope` is one of the boundaries listed in `.lvbt/commit-scopes.txt`. A `feat` or
`fix` commit also needs a body that says what changed for a person using the product and why. The
hook tells you exactly what to change when it rejects a message.

## 4. Open a pull request

Push your branch and open the pull request with the GitHub CLI or the web UI. The pull request
template asks for a TL;DR, an overview of changes, and follow-ups. CI runs `pnpm check` as the
`Validate` status, and a maintainer reviews.

## Where to go next

- `pnpm dev` starts the app; `pnpm build` builds it; `pnpm run deploy` publishes it to Cloudflare
  (`.github/workflows/deploy.yml` does that on every push to `main`).
- The [glossary](../reference/glossary.md) defines every tool and acronym used here.
- `AGENTS.md` at the repository root is the contract for coding agents; it is a good summary of the
  rules for people too.
