# Glossary

Terms used across LVBT repositories, defined once. Docs link here the first time a term appears.

## Tools

<a id="pnpm"></a>**pnpm**: the package manager every LVBT repository uses. It installs dependencies
(`pnpm install`) and runs scripts (`pnpm check`). The version is pinned in `package.json` under
`packageManager`.

<a id="turborepo"></a>**Turborepo**: runs a script (`lint`, `test`, `build`) in every workspace
package in the right order and caches the results. `pnpm check` uses it; you rarely call `turbo`
directly.

<a id="workspace"></a>**Workspace**: a repository holding several packages, listed in
`pnpm-workspace.yaml`. Applications live under `apps/`, libraries under `packages/`.

<a id="catalog"></a>**Catalog**: the `catalog:` block in `pnpm-workspace.yaml` that pins one version
of every tool for the whole organization. A package writes `"catalog:"` as a version and gets the
pinned one.

<a id="eslint"></a>**ESLint**: finds likely bugs and enforces code rules. The rules come from
`@lvbt/eslint-config`.

<a id="prettier"></a>**Prettier**: formats code the same way for everyone, so formatting is never
discussed in review. The settings come from `@lvbt/prettier-config`.

<a id="vitest"></a>**Vitest**: runs unit tests under `tests/`.

<a id="playwright"></a>**Playwright**: runs end-to-end tests in a real browser, under `tests/e2e/`.

<a id="wrangler"></a>**Wrangler**: Cloudflare's command line for deploying Workers.
`pnpm run deploy` calls it.

<a id="gh"></a>**gh**: the GitHub command line. Signing in with `gh auth login` lets the
repository's helper create issues and pull requests for you.

## Terms

<a id="conventional-commit"></a>**Conventional commit**: a commit subject shaped
`type(scope): description`, for example `fix(worker): reject expired share links`. The hook enforces
it.

<a id="scope"></a>**Scope**: the part of a commit subject in parentheses, naming which durable
boundary of the repository the change belongs to. The allowed list is `.lvbt/commit-scopes.txt`.

<a id="ci"></a>**CI**: continuous integration, the automation that runs `pnpm check` on every pull
request. The required status is named `Validate`.

<a id="preflight"></a>**Preflight**: `pnpm preflight`, the check that your machine can build and
deploy this repository, with a fix printed for anything missing.
