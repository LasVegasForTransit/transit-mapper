# Contribution metadata

Issues and pull requests read as direct prose. Their templates use HTML
comments to carry machine-readable section boundaries, so GitHub hides the
prompts and markers after submission instead of turning every response into a
form with visible headings.

Templates are guidance, not authority. API clients and maintainers can bypass
the chooser, so workflows validate every created or edited issue and every
relevant pull request event against the same TypeScript contract in
`packages/github-metadata`.

## The contract

A bug report contains `reproduction`, `expected`, and `actual` prose;
`evidence` is optional. An idea contains `goal` and `current-blocker` prose;
`examples` is optional. A pull request contains `summary`, `reason`, and
`verification` prose; `followups` is optional.

Every start and end marker appears once, in order. Required sections contain
at least 20 non-whitespace characters after HTML comments are removed. Titles
must be trimmed and specific. Issue titles are 10–120 characters. Pull request
titles use the repository's conventional-commit shape and its 72-character
limit.

Draft pull requests validate their title but defer body validation until they
become ready for review. Release Please, Dependabot, and Renovate may omit body
markers only when both the exact bot actor and its expected branch prefix
match. Their titles still validate. This two-part match prevents a human
branch or a lookalike actor from claiming the exemption.

## Commands

Validate metadata already stored as a body:

```bash
pnpm github:validate --kind issue --input issue.json --json
pnpm github:validate --kind pull-request --input pull-request.json --json
pnpm github:validate --event event.json --json
```

The validator exits `0` when valid, `1` for policy failures, and `2` for an
invalid invocation or runtime failure. JSON output is `{ "valid": boolean,
"errors": [...] }`; each error has stable `code`, `field`, and `message`
values.

Create an issue from named values:

```json
{
  "template": "bug",
  "title": "File menu does not open",
  "sections": {
    "reproduction": "Open the File menu from the upper application toolbar.",
    "expected": "The menu opens and its actions can be selected normally.",
    "actual": "The trigger does not react to a pointer or the keyboard.",
    "evidence": ""
  }
}
```

```bash
pnpm github:create-issue --input issue.json --dry-run --json
pnpm github:create-issue --input issue.json --json
```

Use `template: "idea"` with `goal`, `current-blocker`, and optional `examples`
for an idea. The wrapper applies the template's fixed `bug` or `enhancement`
label.

Create a pull request from named values:

```json
{
  "title": "fix(ui): restore menu activation",
  "sections": {
    "summary": "Restore pointer and keyboard activation for every shared menu trigger.",
    "reason": "A global closed-state selector also matched controls that were not surfaces.",
    "verification": "Ran pnpm check and exercised the affected menus at both layout widths.",
    "followups": ""
  },
  "draft": false,
  "base": "main"
}
```

```bash
pnpm github:create-pr --input pull-request.json --dry-run --json
pnpm github:create-pr --input pull-request.json --json
```

The pull request wrapper requires the current branch to have a matching
upstream with every local commit pushed. Both creation wrappers validate
before writing, create through authenticated `gh`, re-fetch the stored title
and body, validate again, and return the GitHub URL and number.

## GitHub enforcement

The pull request workflow uses `pull_request_target` only to run trusted code
from the default branch. It never checks out or executes the proposed head.
With read-only repository access and `statuses: write`, it publishes the
`Contribution metadata` commit status on the pull request head SHA. Editing a
body replaces the result for the same status context and SHA.

The issue workflow keeps invalid issues open. It applies `needs-information`
and creates or updates one marked bot comment with the exact corrections.
When an edit satisfies the contract, it removes the label and deletes the
managed comment. Other labels and human comments are untouched.

`scripts/bootstrap/standards.ts` remains the source of truth for which commit
statuses block merging. `scripts/check-github-metadata.ts` keeps its status
name aligned with the trusted workflow. Agent instructions and optional
vendor hooks may provide earlier feedback, but they never replace GitHub-side
validation.
