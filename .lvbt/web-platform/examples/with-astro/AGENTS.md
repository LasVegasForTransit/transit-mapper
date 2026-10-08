# Working in this repository

Run `pnpm check` after every change. It is the same command CI runs, and a failing check names the
command that fixes it (`pnpm check:fix` repairs everything a machine can).

## Standard commands

Follow the shared
[developer workflow](https://github.com/LasVegasForTransit/repository-tooling/blob/main/docs/reference/developer-workflow.md)
for bootstrap, preflight, validation, audits and explicit staging-to-production promotion. Keep
application-specific checks in Turbo `validate`; change reusable rules upstream.

## Create GitHub issues and pull requests

Use the mandatory `github-contribution` skill from the `lvbt-contributions` plugin whenever a user
authorizes creating an issue or pull request. It carries the organization checklist, readable
templates, and the only approved creation helper:

```bash
node node_modules/@lasvegasfortransit/cli/plugins/lvbt-contributions/scripts/github-create.mjs issue \
  --type bug|feature --title <title> --body-file <file>
node node_modules/@lasvegasfortransit/cli/plugins/lvbt-contributions/scripts/github-create.mjs pr \
  --title <title> --body-file <file> --base main
```

Preview with `--dry-run --json` and inspect the complete Markdown before creating anything. Do not
call `gh issue create`, `gh pr create`, equivalent `gh api` routes, or connector creation tools
directly.

## Commit messages

Subjects are conventional: `type(scope): description`, at most 72 characters. Scopes are optional
and come only from [`.lvbt/commit-scopes.txt`](.lvbt/commit-scopes.txt). Omit the scope when a
change crosses boundaries; never invent one for a feature, file, task, or role.

## The repository standard

Lint, format, TypeScript, and test settings extend the `@lasvegasfortransit/*` packages from
`LasVegasForTransit/repository-tooling`. Change a shared rule there, not here.
