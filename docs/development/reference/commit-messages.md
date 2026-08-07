# Commit messages

The `.githooks/commit-msg` hook enforces the two rules a machine can check
without judgement: the subject is a conventional commit, and it is at most
72 characters. Everything else here is convention, held up by review.

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

One trailer per agent, in the trailer block at the very end, after any
`BREAKING CHANGE:` footer. Name the model that wrote it, not the tool that
ran it, so `git log --format='%(trailers:key=Co-Authored-By)'` answers "which
model touched this" years later.

This was convention nobody had written down until now, and it shows: 19 of
the 200 commits before this one carry the trailer and 181 do not. Nothing was
stripping them — the `commit-msg` hook only ever read the subject line, and
there is no `prepare-commit-msg` hook. Each agent was relying on its own
configuration, and those disagreed.

Whether an agent helped is not something a hook can determine, so the rule
that it must be there is carried by whoever writes the commit. What the hook
does check is the shape, because a malformed trailer is worse than none: it
looks like attribution and does not parse as one.

## What the hook will not catch

It checks the subject and the shape of any attribution trailer, and nothing
else. A body that restates the diff, a `feat` with no body, a wrong type, or
a missing `Co-Authored-By` all pass the hook and get caught in review. The
hook exists to stop the mechanical mistakes, not to replace reading the
message.
