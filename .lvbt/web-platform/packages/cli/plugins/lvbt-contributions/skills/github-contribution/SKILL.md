---
name: github-contribution
description:
  Create or open a GitHub issue or pull request in a LasVegasForTransit repository. Use whenever an
  agent is asked to create, open, file, or publish an issue or pull request.
compatibility: Requires Node.js 24+, git, gh, and authenticated GitHub access.
---

# Create an LVBT GitHub contribution

Use the native, readable repository templates. Never construct hidden metadata or call a GitHub
creation command directly.

## Mandatory checklist

1. Confirm that the user authorized creating the issue or pull request.
2. Search the repository for an issue or open pull request covering the work.
3. Choose the bug, feature, or pull request template from this skill's `assets/`.
4. Write complete, concise repository-specific prose. The TL;DR names the outcome a person can use
   or observe; the overview explains the important behavior, constraint, or trade-off without
   becoming a file inventory. Follow-ups are optional and name unfinished product or reliability
   objectives, never chores such as rebasing, formatting, or running checks. Use `feat` in a
   pull-request title only for a capability someone can use or observe; groundwork belongs under a
   more precise conventional type. Commit scopes are optional. Read the current repository's
   `.lvbt/commit-scopes.txt` before using one; the shared helper validates that repository-owned
   list. Omit the scope rather than inventing one for a feature, file, task, or role.
5. For a pull request, confirm the branch is pushed and run the repository's required validation
   command.
6. Run the helper with `--dry-run` and inspect the complete title and body.
7. Run the same helper without `--dry-run` to create the item.
8. Return the verified URL emitted by the helper.

## Commands

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/github-create.mjs" issue \
  --type bug|feature --title <title> --body-file <file> --dry-run

node "${CLAUDE_PLUGIN_ROOT}/scripts/github-create.mjs" pr \
  --title <conventional-title> --body-file <file> --base main --dry-run
```

Add `--json` for machine-readable output. Remove `--dry-run` only after the preview is correct. Do
not replace the helper with `gh issue create`, `gh pr create`, `gh api`, or a GitHub connector.

## Verified audit automation

Scheduled and manual audit workflows on the default branch use the same helper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/github-create.mjs" audit \
  --input lvbt-audit-report.json --dry-run --json
```

Inspect the complete actions, titles, bug headings, reproduction commands, findings, and artifact
links before removing `--dry-run`. The helper validates the GitHub run, its configured workflow, and
the downloaded report artifact before changing issues. It rejects stale runs and ambiguous
ownership. Each check and target owns one issue with the visible `audit-owned`, `audit:<check>`, and
`target:<target>` labels. Failure updates or reopens that issue; a corresponding verified passing
result closes it. Errors, skipped checks, and absent results never close an issue. The attempt's
measurement job must have successful checkout, setup and enabled prerequisites, a completed audit
command, and successful evidence upload. Failed build, browser installation, cancelled, timed-out or
skipped execution cannot establish recovery. A failed audit command may still report actual findings
when its retained results agree with that command's outcome.

The workflow must serialize reporting with one concurrency group per repository and must upload
`lvbt-audit-report.json` to the configured audit artifact before reporting. Local execution and
untrusted pull request runs may produce reports but cannot maintain audit issues. Writes require the
current executor's repository, run, attempt, commit, branch and event to match the verified
evidence. Declarations must match `.lvbt/tooling.json` at that verified source commit. Read-only
local previews may inspect trusted evidence; altered local declarations cannot change its owner.

## Verified recurring contributions

Product report workflows use the same helper to maintain declared recurring issues:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/github-create.mjs" recurring \
  --input lvbt-recurring-issues.json --dry-run --json
```

Declare each stable key under `contributions.recurring` in `.lvbt/tooling.json`, with its trusted
workflow, evidence artifact name, readable title, bug or feature type, and visible labels. Set
`pin: true` only for a report that should remain pinned. Preserve the template headings in each
complete body. The helper checks the actual default-branch schedule or manual run, attempt, source
commit, latest run, and exact uploaded contribution actions before previewing or writing.

Upload `lvbt-recurring-issues.json` before reporting and serialize issue maintenance with one
repository concurrency group. Inspect the complete preview before removing `--dry-run`. An `open`
action creates, updates or reopens its owned issue. Only an explicit verified `resolved` action
closes the corresponding issue. Missing, errored and skipped actions never close issues. Every write
verifies stored title, body, state, labels and the requested pin. Reporting failures fail the
workflow. The visible `recurring-owned` and `recurring:<key>` labels identify ownership; pull
requests and other automation's issues cannot be maintained by this route.

For a reviewed migration, `adoptExisting: true` permits adopting one exact title and configured
label match. The helper requires GitHub Actions bot authorship, no other automation ownership and an
update timestamp no later than the verified run's start. Ambiguous or unverifiable adoption fails;
it never silently replaces the existing stable issue. Local and pull request runs cannot maintain
recurring issues.
