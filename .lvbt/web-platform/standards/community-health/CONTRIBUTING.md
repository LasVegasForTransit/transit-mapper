# Contributing to LVBT

Start with the repository's application guide. Run `pnpm bootstrap` to prepare local development,
`pnpm dev` to preview, and `pnpm check` before sharing a change. Local setup does not require cloud
credentials. Optional integrations are configured only when needed.

Work on a branch and use a pull request. Follow the repository's declared commit scopes and required
Validate status. Humans use the native issue forms and pull request template; coding agents use the
pinned lvbt-contributions helper, preview the complete contribution, and verify the stored URL.

Trusted default-branch audit automation uses the same helper to maintain one issue per check and
target with visible ownership labels. Errors, skipped checks, missing reports, and stale runs never
close a finding. Failed audit setup, build or browser installation cannot establish recovery; the
helper verifies the attempt's completed measurement job and successful evidence upload while
allowing the audit command to fail with actual findings. The helper previews and verifies every
issue reconciliation operation. Writes require the matching GitHub executor and declarations from
the verified source commit; local or pull request executors cannot replay trusted evidence to mutate
issues.

Product reports also use the approved helper's `recurring` route. Repository-owned declarations keep
titles, templates, labels and pin behavior explicit. Trusted default-branch schedule or manual
workflows upload the exact contribution actions, preview them, and verify stored issue readback.
Only an explicit verified resolution closes its matching owned issue; errors, missing actions and
stale evidence cannot clear it. Reviewed legacy adoption requires unique visible ownership, bot
authorship and verified timestamps. Conflicting automation ownership blocks reconciliation.

For deployable applications, main updates staging. Production publication is an explicit promotion
of a saved artifact. Use the shared release command and retain its publication evidence.

Shared tools and process changes belong in
[repository-tooling](https://github.com/LasVegasForTransit/repository-tooling). Repositories provide
application configuration, budgets, and product acceptance through its documented extension points.
