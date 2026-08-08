# Commit messages

The `.githooks/commit-msg` hook enforces the rules a machine can check without
judgement: the subject is a conventional commit, it is at most 72 characters,
and any attribution footer is shaped so git can read it. `prepare-commit-msg`
adds that footer when an agent is running git. Everything else here is
convention, held up by review.

## Subject

```
type(optional-scope): description
```

Lower case, no trailing period, at most 72 characters. Write it as what
the change does, not what you did: `fix: stop station labels overlapping`,
not `fixed the label bug`.

| Type       | Use for                                         |
| ---------- | ----------------------------------------------- |
| `feat`     | new capability someone can use                  |
| `fix`      | corrected behaviour                             |
| `docs`     | documentation only                              |
| `style`    | formatting with no behaviour change             |
| `refactor` | restructuring with no behaviour change          |
| `perf`     | faster or cheaper, same behaviour               |
| `test`     | tests only                                      |
| `ci`       | workflows, actions, deployment pipeline         |
| `chore`    | tooling and maintenance that fits nothing above |

Scope is optional and rarely needed in a repository this size. Use it when
a change is confined to one clearly named area.

## Body

**Required for `feat` and `fix`.** Optional elsewhere, and usually worth
writing anyway.

Wrap at 72 columns. Explain **why**, not what — the diff already says what.
The reader is a maintainer six months from now who has none of the context
that produced the change, and who is trying to work out whether they can
safely change the thing you touched.

Worth including when it applies:

- the constraint, trade-off, or failure the change avoids
- what you measured, and what the number was
- what you considered and rejected, and why
- anything that looks wrong but is deliberate

## Two examples from this repository

A `fix` whose body carries the reasoning:

```
fix: typecheck the test suite, which never had been

apps/web/tsconfig.json includes only "src", so the 3,202-line verify.ts
had never been typechecked and had drifted into nine errors.

Nine, not the 28 first reported. Measuring it took two attempts, and that
is the more useful half of the finding: widening the existing config's
include reports 28, but 18 are artefacts of the config itself.
```

A `feat` that records a rejected alternative:

```
feat: add pnpm preflight, which catches a stale node_modules

Named preflight, not doctor. `doctor` is a built-in pnpm subcommand and a
package.json script by that name is silently shadowed — the first version
looked like it passed because pnpm's own diagnostics ran instead.
```

## Attribution

A commit written with help from a coding agent ends with a trailer naming it:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

One trailer per agent, in the footer block at the very end, beside any
`BREAKING CHANGE:` footer. Name the model that wrote it, not the tool that ran
it, so `git log --format='%(trailers:key=Co-Authored-By)'` answers "which
model touched this" years later.

**A person writing their own commit adds nothing.** Attribution says an agent
helped; silence says one did not, and that is the common case for a human at a
keyboard. Nothing requires the footer.

You should not have to remember this. `prepare-commit-msg` adds a footer
whenever an agent is the thing running git, which it knows from `AI_AGENT` or
`CLAUDECODE` in the environment. That hook is a floor rather than the whole
rule: the environment says which _tool_ is running and never which _model_ —
`ANTHROPIC_MODEL` is empty even under Claude Code — so it can only write
`Claude Code`. An agent that names its own model writes a better footer, and
the hook never overwrites one that is already there, so the precise version
survives and only a missing one gets the fallback.

This was convention nobody had written down until now, and it shows: 19 of the
200 commits before this one carry the trailer and 181 do not. Nothing was
stripping them — the `commit-msg` hook only ever read the subject line, and
there was no `prepare-commit-msg` hook at all. Each agent was relying on its
own configuration, and those disagreed.

`commit-msg` checks the shape of any footer it finds, because a malformed one
is worse than none: it looks like attribution and parses as nothing.

## What the hook will not catch

It checks the subject and the shape of any attribution footer, and nothing
else. A body that restates the diff, a `feat` with no body, and a wrong type
all pass and get caught in review.

Attribution is the one rule split across both hooks, because neither half
works alone: `prepare-commit-msg` can add a footer only while the agent is
still the process running git, and `commit-msg` can check a footer's shape but
never whether one was owed. A commit made by an agent outside that hook — a
`git commit` from a container without the environment, say — passes both and
carries no attribution.

The hooks exist to stop the mechanical mistakes, not to replace reading the
message.
