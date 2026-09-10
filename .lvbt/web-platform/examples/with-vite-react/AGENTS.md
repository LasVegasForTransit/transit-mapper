# Working in this repository

Run `pnpm check` after every change. It is the same command CI runs, and a failing check names the
command that fixes it (`pnpm check:fix` repairs everything a machine can).

## Standard commands

Every LVBT repository answers to the same commands:

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `pnpm bootstrap`      | Install dependencies, wire git hooks, and run preflight    |
| `pnpm preflight`      | Confirm the machine can build and deploy this repository   |
| `pnpm check`          | Format, docs, shape rules, lint, types, tests, repo checks |
| `pnpm check:fix`      | Apply formatting and lint fixes                            |
| `pnpm build`          | Build every package                                        |
| `pnpm test`           | Run every package's tests                                  |
| `pnpm run deploy`     | Build, then `wrangler deploy` every app (deployable repos) |
| `turbo gen workspace` | Scaffold a new package or app                              |

## Create GitHub issues and pull requests

Use the mandatory `github-contribution` skill from the `lvbt-contributions` plugin whenever a user
authorizes creating an issue or pull request. It carries the organization checklist, readable
templates, and the only approved creation helper:

```bash
node node_modules/@lvbt/cli/plugins/lvbt-contributions/scripts/github-create.mjs issue \
  --type bug|feature --title <title> --body-file <file>
node node_modules/@lvbt/cli/plugins/lvbt-contributions/scripts/github-create.mjs pr \
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

Lint, format, TypeScript, and test settings extend the `@lvbt/*` packages from
`LasVegasForTransit/repository-tooling`. Change a shared rule there, not here.
