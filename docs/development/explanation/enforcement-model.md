# How this repository enforces its own rules

Written for a person. If you have just been stopped by a check and want to
know why it exists, this is the page.

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

The point of it being one command is that a red CI run maps to exactly one
thing to run locally. You should never have to work out which of six tools
is unhappy.

## Layers

| Layer          | What runs                             | Blocks on                   |
| -------------- | ------------------------------------- | --------------------------- |
| 0 — agent      | format-on-edit hook in `.claude/`     | nothing                     |
| 1 — pre-commit | `lint-staged`, plus a secret scan     | nothing a machine can fix   |
| 2 — pre-push   | `pnpm check`                          | everything                  |
| 3 — CI         | `pnpm check`, plus a full secret scan | everything, authoritatively |

Layers 0 to 2 are conveniences and they are bypassable on purpose.
`--no-verify` exists, and a hook that is slow or that scolds gets bypassed
— at which point it enforces nothing at all. Making them unbypassable
would train people to work around them.

**Layer 3 is the guarantee.** Nothing merges red.

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

### core-runtime-purity

`packages/core` runs in two runtimes: the browser and workerd. A
browser-only global compiles cleanly and then throws in production, in
whichever runtime nobody exercised.

The compiler cannot catch this, and that is the whole reason the rule
exists. Core's tsconfig pulls in the `DOM` lib deliberately, to get the
ambient `fetch`, `crypto` and `structuredClone` typings that _both_
runtimes provide — which means it also gets `window` and `document`, which
only one provides.

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
