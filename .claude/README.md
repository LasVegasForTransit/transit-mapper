# Agent configuration

Claude is the agent this project is set up for, but the repository stays agent-agnostic. The rule
for what belongs here:

> **Repository tooling checks artifacts. Agent configuration constrains actions.**

If a human doing the same thing would be caught by `pnpm check`, it belongs in repository tooling.
Agent configuration covers the cases where the harm happens before any artifact exists, so there is
nothing for a check to inspect.

`packages/core` importing `document` leaves an artifact, so it is a lint rule. Reading `.dev.vars`
leaves no trace in the repository at all, so no check can ever see it; that one is irreducibly agent
configuration.

## What is in here

**`settings.json`** — committed team policy, reviewed in pull requests like any other rule. It
contains two things:

- A `PostToolUse` hook that formats a file right after an agent edits it. This is an accelerator: it
  introduces no rule, it just means the agent's output already meets the bar before it reaches a
  commit, so the pre-commit hook has nothing to report. It ends in `|| true` on purpose — an
  accelerator that fails must never block the work.
- `permissions.deny` entries for secret-bearing paths, so those values cannot enter model context in
  the first place. This is enforcement at the harness layer, and it is the one thing here that no
  repository check could replace.

**`settings.local.json`** — personal preferences. Gitignored, and must stay that way. Under a Team
plan the committed file is shared across every seat automatically, which is exactly why the deny
list belongs there and not here.

## The test, which CI already runs

> Delete `.claude/` entirely. Does the repository still enforce every correctness rule?

It has to, and you do not have to remember to check: GitHub Actions has no `.claude/settings.json`
and no agent, so a green CI run is proof that enforcement does not depend on one.

If you ever add something here that changes what `pnpm check` accepts, it is in the wrong place.

## Adding a secret-bearing path

Add it to `permissions.deny` here **and** to `.gitignore`. The deny list stops an agent reading it;
`.gitignore` stops anyone committing it. They are different failures and both need covering.
