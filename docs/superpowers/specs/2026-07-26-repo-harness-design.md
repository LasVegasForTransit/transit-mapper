# A repository harness for a small team

## Status

Recorded 2026-07-26, after implementation. This document is a design record
and is not rewritten as the work lands — but a reader needs to know which
parts describe the repository and which describe an intention, and three
findings in Context turned out to be stale before the work started.

**Shipped.** Tracks 1, 2 (in part), 3, 4, 5 (in part), 6, 7, 8 and 10.
`pnpm check` is the single gate and runs formatting, root and per-package
lint, typecheck, the workspace contract, documentation links, migration
append-only, project structure, the generated checks reference, generated
Worker types, and both test suites. Four enforcement layers, three secret
nets, a version catalog, one custom lint rule, three generators, the domain
documentation layout, and a bootstrap that provisions rather than only
verifying.

Updated 2026-07-27, when the branch landed on `main`. Track 5's governance
is applied: the `org-standard` ruleset is active on the default branch,
requiring a pull request and a passing `Validate` check, forbidding
deletion and force-push. `pnpm bootstrap --doctor` reports it as matching.
CI has now run, repeatedly and green; the claim below that it never had is
what this paragraph replaces.

**Not shipped.** Track 9's template extraction, which the Sequencing
section gates on the harness surviving contact. The organization transfer,
and the merge queue that depends on it. Two of the four unenforced
invariants in `AGENTS.md` — the `/api` route shape and named-interface
parameters — which Track 3 specified as lint rules and which remain
enforced by nothing. The `lint-rule` generator exists to scaffold both.

**Known defects, recorded rather than fixed.** A pull request branch runs
`Validate` twice, once from `push` and once from `pull_request`. The
spatial-grid assertion is still a wall-clock bound, mitigated by running
verify with `--concurrency=1`. The `check()` suites and Vitest still
coexist. The ruleset asks for zero approving reviews, because a repository
with one collaborator cannot satisfy one; the reasoning is in
[the enforcement model](../../development/explanation/enforcement-model.md).

**Corrections to Context.** Three findings were true of the branch point and
already fixed on `main` by the time the work landed, which was discovered
only during the rebase:

- D1 migrations _are_ applied by the deploy pipeline (`2a39058`).
- `scripts/` in both apps _is_ typechecked, through `tsconfig.scripts.json`.
- `apps/worker` _does_ have tests, in `apps/worker/scripts/verify.ts`.

Main's version of each was kept and the corresponding work here discarded.
The general lesson is recorded rather than buried: this branch ran for a
long time without checking `HEAD..main`, and reported findings to its reader
that had stopped being true.

Two further corrections, both from running the thing rather than reading it.
The 28 typecheck errors were nine; the other eighteen were artefacts of
measuring through a config that disables automatic `@types` resolution. And
the suite has 682 static `check(` call sites but executes 741 assertions
across 738 distinct names, so the codemod guard specified below as a count
would have passed while a looped case collapsed into a single test.

**Deliberately not built.** A lint rule for the `HTMLRewriter` convention.
The two places the Worker builds markup by interpolation are both correct,
and separating a safe interpolation from an unsafe one needs value
provenance a linter does not have. `AGENTS.md` records that row as
unenforced rather than leaving it looking merely unwritten.

## Development principles

Every decision in this document cites one of these. A proposal that can't
name the principle it serves doesn't go in. When two conflict, the
lower-numbered principle wins.

These are deliberately free of implementation detail. They govern any
repository Las Vegans for Better Transit maintains, not just this one, and
they should survive replacing every tool named in this document.

1. **Developer experience comes first.** The developer is a user, too. Any
   action that is expected to be performed more than once, whether setup or
   maintenance, must have clear documentation and tools to use without
   needing to memorize long or complex commands.

2. **Tooling should be self-healing and minimize toil.** If a problem can
   be fixed automatically, it must be fixed automatically, or else present
   clear, interactive options to the developer.

3. **Tooling should be a guardrail for all developers.** The repository
   should enforce best practices by default, both on a developer's machine
   and remotely.

4. **Design for many.** Repository tooling must be architected so that
   multiple people can work on overlapping features at the same time, and
   code is still continuously and safely integrated, to minimize toil.

5. **Maintainability and sustainability.** It must be possible for someone
   with a basic programming background and zero preexisting knowledge of
   the project to understand and deploy a complete instance of the app by
   running a single command, or a few, that the repository exposes as
   first-class commands.

6. **Performance comes early.** Every wasted build minute builds up over
   time, so repository tooling should always strive to improve performance
   and save resources while preserving the developer experience.

7. **Standards, standards, standards.** Development decisions should be
   based on written standards, not made case by case. Questions like "how
   should we architect this" must build on architecture documentation that
   every repository is required to carry. Where a standard doesn't exist
   yet, writing it is part of the work.

## Standard technology

The stack every Las Vegans for Better Transit project uses unless it has a
written reason not to. The point is not that these are the only defensible
choices; it is that a developer moving between our repositories should not
have to learn a new toolchain each time, and that one shared harness can
serve all of them (see track 9).

| Layer                 | Choice                                     | Notes                                                  |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Language              | TypeScript, `strict`                       | 6.x — see the note below                               |
| Runtimes              | Node 24 for tooling, workerd in production | `packages/core` must run in both                       |
| Package manager       | pnpm 11, workspaces                        | version pinned by `packageManager`                     |
| Task orchestration    | Turborepo                                  | every check is a task in the graph                     |
| Source hosting and CI | GitHub, GitHub Actions                     | organization-owned, public by default                  |
| Hosting and data      | Cloudflare Workers, D1, R2                 | free tier is a real design constraint                  |
| Deploy tooling        | Wrangler                                   | configuration in `wrangler.toml`, reviewable in a diff |
| Frontend              | React, Vite, Tailwind, Zustand             | Radix for accessible primitives                        |
| Mapping               | MapLibre GL                                | no proprietary tile or SDK dependency                  |
| Worker framework      | Hono                                       |                                                        |
| Testing               | Vitest, `@cloudflare/vitest-pool-workers`  | Worker tests run in real workerd                       |
| Lint and format       | ESLint with typescript-eslint, Prettier    | type-aware rules are a requirement, not a preference   |
| Documentation         | Markdown in `docs/`, Diátaxis structure    | tutorials, how-to, reference, explanation              |

Two constraints shape most of these. The organization is a nonprofit, so
recurring cost is scrutinized and the Cloudflare free tier is a design
input rather than an accident. And the team is small and partly
newcomers, so a tool that requires expertise to operate safely is a worse
choice than a slower tool that does not.

### One version of everything, in a catalog

Every external dependency is declared once, under `catalog:` in
`pnpm-workspace.yaml`. Package manifests say `catalog:` where a version
range would go, so two packages cannot end up on different versions of the
same library without that showing up as a change to one shared file.

This is enforced, not conventional: `pnpm check` fails when a manifest
pins a literal range, and names the package, the dependency, and the fix.
It is also what makes the upgrade rule below mechanical — there is exactly
one place to change a version, and one diff to review.

Adopted at 29 dependencies, two of which (`tsx`, `@types/geojson`) were
already declared in two packages each. They happened to agree. Nothing
had been keeping them that way.

### Take the newest version every core dependency supports

Not the newest version published. A dependency is adoptable when the
toolchain around it — linter, test runner, build tooling, framework
integrations — can actually consume it. Being early costs more than it
returns, and the cost lands on whoever has to work around the gap rather
than on whoever chose the version.

Upgrade automation follows the same rule: it proposes the newest version
that keeps `pnpm check` green, and a bump that requires disabling a check
to land is not an upgrade.

**TypeScript is the worked example.** The repository moved to TypeScript 7
— the native Go compiler — in July 2026, while it was `latest` on npm.
TypeScript 7.0 shipped without a stable programmatic API; Microsoft
expects 7.1 to provide one. Until then nothing that reads the compiler API
can follow, which is `typescript-eslint`, and also Vue, Angular template
checking, Svelte, Astro, `ts-jest`, and `ts-morph`. `typescript-eslint`
closed the TS 7 request as not planned and tracks `>=7.1` separately; the
blocker is upstream, not reluctance.

So the repository is on TypeScript 6.0.3, which is what `website` also
uses. Microsoft publishes `@typescript/typescript6` so TypeScript 6 can sit
beside 7 for tooling, and that split was considered and rejected: it buys
about 2.7 seconds on a cold typecheck, on a command whose warm case is
66ms because Turborepo replays it, and costs two TypeScript installations
that every contributor has to understand — against principles 1 and 5, and
with a known expiry.

Migrate when the core dependencies are ready, together, and not before.

## Context

TransitMapper is 21,600 lines across `packages/core`, `apps/web`, and
`apps/worker`, deployed to Cloudflare Workers with D1. The code is careful
and the inline comments are dense. What's missing is enforcement: the
repository documents its rules but almost never executes them.

The team is about to grow to a handful of developers, mentored rather than
senior, working alongside coding agents. Both groups need the same thing —
to be told immediately and specifically when they've done something the
project doesn't allow, rather than discovering it in review or production.

The sibling `LasVegansForTransit/website` repository is the org's reference
implementation for onboarding and CI conventions: a 3,749-line bootstrap
CLI with resumable state and a `--doctor` mode, composite actions, pinned
action SHAs, environment-scoped secrets. This spec adapts those conventions
and extends them, then track 9 extracts the result so both repositories and
future ones share one harness.

### Current state, measured

- **No linter and no formatter.** No ESLint, Biome, or Prettier config
  exists anywhere in the repository.
- **`apps/web/tsconfig.json` sets `"include": ["src"]`**, so the entire
  test suite in `apps/web/scripts/verify.ts` — 3,202 lines, 682 `check()`
  call sites — had never been typechecked, and had drifted.

  Measuring this took two attempts, which is itself the finding. Widening
  the existing config's include reports 28 errors, but 18 of those are
  artefacts of that config rather than defects in the code: `apps/web` sets
  `"types": ["vite/client"]`, which disables automatic `@types` resolution,
  so `@types/geojson` goes missing (2 × TS2307 inside `packages/core` files
  pulled in transitively) and 16 callback parameters lose their contextual
  type and report TS7006. Under a config that does not inherit that
  narrowing, all 18 disappear.

  Nine real errors remain, all in `verify.ts`: 4 × TS2300, from `snap` and
  `squareFootprint` each being imported twice; 2 × TS6133 unused locals;
  1 × TS2345, an OSM fixture whose inferred `tags` union is not assignable
  to `Record<string, string>`; 1 × TS2531, a `getState().selection` read
  narrowed on one call and dereferenced on a second; and 1 × TS2367, a
  brand-token comparison between two `as const` literals that TypeScript
  can decide statically. All nine are fixed in track 1.

  The underlying finding survives the correction, and is the more important
  half: **the two typecheck configurations disagreed about the same source
  file.** One of them could not resolve a module the other could.

- **`check()` increments a counter.** No isolation, one shared module-level
  store, and the first _thrown_ exception aborts every remaining check
  silently.
- **`apps/worker` declares no `verify` script.** Per the rule in
  `AGENTS.md`, a package without the script is skipped without an error and
  CI still passes. The Worker — the only component touching D1, cookies,
  and untrusted input — has zero tests, invisibly.
- **Nothing applies D1 migrations.** `wrangler deploy` does not run them
  and `.github/workflows/deploy-production.yml` does not either. The only
  record of the command is inside `docs/superpowers/plans/`. Merging a
  migration together with code that reads the new column produces a green
  deploy and a broken production.
- **`apps/worker/wrangler.toml` hardcodes `database_id`.** A fresh
  Cloudflare account cannot deploy this repository. Nothing creates the
  database, applies its migrations, or binds the custom domain.
- **`apps/web/.env` and `.env.development` are committed.** The values are
  harmless today (a public URL), there is no `.env.example`, and no
  environment variable is validated at startup.
- **There is no contributor documentation.** Every guide in `docs/how-to/`
  except `local-development.md` teaches a _user_ how to operate the editor.
  Nothing anywhere explains how to add a migration, add an API route, add a
  package, or write a test — those procedures exist only inside
  `AGENTS.md`. Under principle 1 this is the largest gap in the repository:
  `AGENTS.md` is currently the only contributor documentation, which means
  agents have instructions that humans do not.
- No CODEOWNERS, Renovate or Dependabot config, git hooks, PR or issue
  templates, or `SECURITY.md` — all of which `website` has.

### The gap this is really about

`AGENTS.md` states these rules. The right-hand column is what fails if you
break them:

| Rule                                                              | Enforced by |
| ----------------------------------------------------------------- | ----------- |
| Named interfaces, never inline parameter types                    | nothing     |
| `packages/core` must not touch `window`/`document`/`localStorage` | nothing     |
| Never string-concatenate stored values into HTML                  | nothing     |
| `/api` is REST — no verb-in-path endpoints                        | nothing     |
| Never edit an already-applied migration                           | nothing     |
| Package scripts must match turbo task names                       | nothing     |
| `pnpm typecheck && pnpm verify` before a pull request             | CI          |

Converting that column is the work (principle 3).

## Goals

- One command, `pnpm check`, is the complete definition of a valid working
  tree, and it is what CI runs.
- Rules that are currently prose become commands that fail, each with a
  message naming the fix (principles 1 and 3).
- New packages, migrations, API routes, and lint rules are generated
  already-conformant (principle 2).
- `AGENTS.md` describes what agents should do and why, and links to
  human-readable documentation for how. Every rule an agent follows has a
  page a person can read (principle 1).
- **The contributor documentation those links point at is written as part
  of this work**, not assumed to exist. Today it does not exist at all, so
  authoring it is a deliverable with the same weight as the tooling
  (principle 1).
- A fresh machine and a fresh Cloudflare account reach a verified
  production deployment with one command (principle 5).
- Migrations apply automatically as part of deployment, gated on CI
  (principle 5).
- Two people working on overlapping features can both land safely, because
  each change is tested against the actual merged result rather than
  against its own branch (principle 4).
- Every check is a Turborepo task with declared inputs, so caching and
  `--affected` filtering would be correct if it were used (principle 6).
- The local environment cannot silently disagree with the lockfile, and
  when it does, repairing it is one command (principles 2 and 3).
- No developer and no agent ever holds a production credential, and the
  set of secrets that exist at all stays small enough to enumerate
  (principle 3).

## Non-goals

- Changing application behavior. No feature work, no UI changes, no schema
  changes beyond what migration automation requires.
- Preserving the shape of the existing checks permanently. They are
  migrated mechanically first, so that nothing is lost, and then rewritten
  as real tests. Both halves are in scope; see track 2.
- Porting `website`'s content-quality suite (Lighthouse, axe, visual
  regression, `alex`, `cspell`). Those are tuned for a marketing site and
  don't fit a map editor.
- Extracting shared packages in this cycle. Everything is built inline
  here, with extraction deliberately scheduled as track 9. Configuration is
  authored so that extraction is a move rather than a rewrite: no
  repository-specific paths inside rule definitions.
- A test framework migration that changes coverage. The migration is
  guarded to preserve every assertion exactly (see track 2).

## Development workflow

This section is the standard for every application Las Vegans for Better
Transit maintains, not only this one. It is written here because this is
where it is being built first.

### Pull requests are not code review

Treating the two as the same thing is what makes "do we need pull
requests?" feel like a trade-off. A pull request is the only mechanism
that provides a remote gate, a merge queue, a preview
deployment, a revert button, and an audit trail. Code review is a separate
policy layered on top of it.

Pull requests are required for every change. What review they need is a
separate decision.

Direct pushes to `main` are disabled, including for administrators.
`main` deploys to production, and the local checks are bypassable by design
— `--no-verify` exists and people under deadline use it. Allowing direct
pushes would mean the only thing between a typo and production is a hook
any human or agent can skip, which satisfies exactly half of principle 3.

### The repository moves to the organization

GitHub's merge queue requires a repository that is both public and owned by
an organization. `LasVegasForTransit/website` already qualifies.
`WillieCubed/transit-mapper` is public but owned by a personal account, so
it is ineligible today.

Transferring it to `LasVegasForTransit` enables merge queue at no cost, and
provides organization teams for CODEOWNERS plus organization-level rulesets
configured once for every current and future repository. GitHub redirects
the previous URL, so existing clones and links continue to work; the README
badge and CONTRIBUTING links are updated in the same change.

Neither repository currently has any ruleset or branch protection at all.

### Merge queue

Each pull request is tested against the actual result of merging it, not
against its own branch in isolation. This is what principle 4 requires:
without it, two pull requests that are independently green can break `main`
when both land, and the failure appears on someone else's unrelated change.

### Review policy

Every pull request requires one approval. The team is being mentored, and
review is where that happens. The cost of a blocking human step is accepted
deliberately.

**The constraint this creates, and how it is handled.** GitHub does not
permit approving your own pull request. While the team is one person, a
blanket approval requirement would block every change that person authors.

- Most changes in this repository are agent-authored. The agent opens the
  pull request and the maintainer approves it. That is a real second pair
  of eyes, and the policy works as intended with a single human.
- For the maintainer's own hand-written changes, the ruleset carries a
  named bypass for the repository owner. It is recorded in the ruleset,
  where it is visible and auditable, rather than exercised as an unlogged
  administrator override. Its removal condition is written down: the second
  developer joining.

Review is required everywhere, so CODEOWNERS is used to route changes to
the right reviewer rather than to decide whether review happens.

### Deployment

1. Every pull request gets a preview deployment.
2. Merging to `main` deploys to production automatically. Small batches are
   what actually makes deployment safe, and a promotion step that people
   forget to press produces large ones.
3. Migrations apply in the pipeline, before the Worker deploys.
4. A post-deploy smoke test runs against the live URL. Failure triggers
   `wrangler rollback` automatically.
5. `wrangler versions deploy` traffic splitting is available for changes
   that warrant a gradual rollout. It is not the default, because the
   latency it adds to every deploy is not justified at this traffic level.

### Expand and contract

The rule that matters most for continuous deployment against a database:

> A deploy is not atomic, and a rollback does not un-migrate.

Deploying a migration together with the code that depends on it, and then
rolling the Worker back, leaves the new schema running against the old
code. The rollback makes the incident worse.

Therefore every migration must be safe against the _previous_ deployed
version of the Worker. Migrations are additive; columns and tables are
added, never dropped or renamed in the same change that starts using them.
Removal happens in a later, separate change, once no deployed code refers
to the old shape.

This is enforced by a check.

### First-class commands

Principle 5 requires the repository to expose its workflows as commands:

| Command            | Does                                                           |
| ------------------ | -------------------------------------------------------------- |
| `pnpm check`       | the complete definition of a valid working tree                |
| `pnpm check --fix` | everything a machine can repair, repaired                      |
| `pnpm ship`        | branch, commit, push, open the pull request, enable auto-merge |
| `pnpm bootstrap`   | nothing to a verified production deployment                    |
| `pnpm preflight`   | diagnose and repair the local environment                      |

`pnpm preflight` exists because of a failure found while writing this spec:
`pnpm-lock.yaml` pinned wrangler 4.114.0 while the installed tree was
3.114.17. CI installs with `--frozen-lockfile` and would have used 4.x
while a developer used 3.x, and nothing anywhere reported the discrepancy.
Comparing the installed tree against the lockfile is a check, and repairing
it is automatic (principle 2).

It is named `preflight` rather than `doctor` for two reasons. `doctor` is
a built-in pnpm subcommand, and a `package.json` script by that name is
silently shadowed — during implementation the drift check appeared to pass
because pnpm's own diagnostics ran instead. And `website` already exposes
this idea as `pnpm preflight`, so the two repositories now agree.

## Documentation layout

The standard for every organization repository. It exists so that "where
does this page go?" has one answer. That keeps documentation findable as it
grows, and lets a check verify the structure.

### Domains, then modes

**The top level of `docs/` contains domain folders and nothing else.**
[Diátaxis](https://diataxis.fr/) modes live one level down, inside a
domain. A bare `how-to/` at the root would mean the reader has to already
know which audience it serves.

```
docs/
  README.md              index; every page below is linked from here
  product/               using the app
  development/           changing the code
  operations/            keeping it running in production
  security/              credentials, threat model, disclosure
  superpowers/           dated records; not a domain, see below
```

Every domain carries the same four subdirectories and fills the ones it
needs:

```
<domain>/
  tutorials/             learning-oriented
  how-to/                task-oriented
  reference/             lookup
  explanation/           why it works this way
```

Uniform structure is what makes the layout predictable enough to check and
to copy into a new repository.

**A domain is the reader's situation, not a topic.** Someone using the app,
someone changing the code, someone keeping it running, someone handling a
credential or a vulnerability report — four different readers, or the same
person on four different days, with nothing to say to each other. Pages
read in the same situation belong in the same domain. Adding a domain is a
decision recorded in `docs/README.md`, not an ad-hoc directory.

The split earns its keep at `operations/`. Deploy and rollback pages get
read under pressure, often by someone who did not write the code, and
filing them next to "how to add a lint rule" costs time at the exact moment
there is none.

`superpowers/` sits at the top level without being a domain because it is
not documentation. It is an archive of dated records, described below. Its
name comes from the tool that generates the specs, which is a poor name for
a standard every repository adopts; renaming it to `decisions/` is worth
doing at the same time, and costs one directory move.

**What moves.** All sixteen existing pages relocate. Fourteen are product
documentation and go to `product/`, keeping their current mode
subdirectory. Two are not: `local-development.md` goes to
`development/how-to/`, and `project-structure.md` — which describes the
source tree, not the app — goes to `development/reference/`, where the
required-documents list already expects it.

One page is a genuine judgment call. `product/explanation/design-principles.md`
covers catalog-driven kinds and style/domain separation, which reads as
product explanation, but `AGENTS.md` points contributors at it as "the
reasoning behind the domain model." It is classified when it is moved, and
whichever domain it lands in, `AGENTS.md`'s link updates to match.

`docs/README.md`, the root `README.md`, and `CONTRIBUTING.md` all update
their links in the same change. This is real churn — sixteen files and
every inbound link, including any from the org website — and it is worth
paying once, now, while the set is small and before track 3 writes
seventeen new pages into the old shape.

### Specs and plans are records, not documentation

`superpowers/specs/` and `superpowers/plans/` hold dated design records.
They describe what was decided and why, at a point in time.

**They are never updated after the work lands.** If reality diverges from a
spec, the living documentation changes and the spec stays as written. It is
evidence of a decision, and rewriting it destroys the only account of why
the choice was made. Current behavior lives in the domain folders; the
reasoning lives here, and is historical.

### Required documents

Principle 7 says architecture decisions build on documentation the
repository is _required_ to carry. Required means checked: `pnpm check`
fails when one of these is absent, so a repository cannot reach production
without them.

| Document                                                              | Answers                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `development/explanation/architecture.md`                             | what the pieces are, how they communicate, which boundaries are load-bearing |
| `development/explanation/enforcement-model.md`                        | why the harness is shaped this way, for a person                             |
| `development/reference/project-structure.md`                          | what lives where in the source tree                                          |
| `development/reference/checks.md`                                     | every check, what it enforces, its fix                                       |
| `operations/how-to/deploy-and-roll-back.md`                           | how a deploy works and how to reverse it                                     |
| `operations/how-to/restore-the-database.md`                           | what to do when D1 is wrong or gone                                          |
| `security/reference/secrets.md`                                       | every secret, its blast radius, its rotation command                         |
| `security/explanation/threat-model.md`                                | what we defend against, including the agent-specific paths                   |
| `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md`, `LICENSE` | the root set every repository carries                                        |

`architecture.md` is the one this principle is really about. `AGENTS.md`
already demands that a change adding a subsystem document how it works and
why, but that instruction has no destination today — there is no
architecture document to add to. This creates it, and the requirement gives
the existing rule somewhere to land.

The list is the standard for every organization repository, which is what
makes it extractable in track 9. A repository with nothing to say under a
heading writes that down.

### Conventions

- **Filenames** are kebab-case. How-to pages are verb-first
  (`add-a-migration.md`, `draw-roads.md`); reference and explanation pages
  are noun-phrases (`data-model.md`, `enforcement-model.md`).
- **Every page is linked from `docs/README.md`** with a one-line
  description of what it answers. An unlinked page is unfindable and is
  treated as a defect.
- **Generated pages say so** in their first line, and are never edited by
  hand. `development/reference/checks.md` is generated from the check
  registry.
- **Link to source files by path**, and expect the checker to catch it when
  the source moves.

### Enforcement

Structure that is not checked drifts, and this repository already
demonstrates it. There are four broken links today: `docs/README.md`
advertises a `operations/how-to/operations.md` covering deploy, rollback, migrations
and database restore that was never written, and three reference pages
point at `../../src/model/`, a path that stopped existing when the
monorepo split moved those files under `packages/core/`.

`pnpm check` therefore verifies:

- every relative link resolves, using an established link checker. A
  hand-rolled version written while drafting this spec reported clean and
  missed the `operations.md` break;
- every page under `docs/` is reachable from `docs/README.md`;
- every page named in `docs/README.md` exists;
- `development/reference/project-structure.md` matches the real tree;
- generated pages are not stale.

## Agent tooling versus repository tooling

Claude is the agent of choice — the organization anticipates a nonprofit
Claude Team plan — but every repository stays agent-agnostic wherever it
can. This section is the rule for deciding where a given piece of
enforcement belongs.

### The line

**Repository tooling checks artifacts. Agent configuration constrains
actions.**

The test is one question: _if a human did this, would `pnpm check` catch
it?_ If yes, it belongs in repository tooling, always. If the harm happens
before any artifact exists, there is nothing for a check to inspect, and
agent configuration is the only place it can live.

`packages/core` importing `document` leaves an artifact, so it is a lint
rule. Reading `.dev.vars` leaves no trace in the repository at all, so no
check can ever see it; that one is irreducibly agent configuration.

### Three categories

| Category                                        | Enforces for                                     | Example                                                           |
| ----------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| **Repository tooling** — authoritative          | everyone, regardless of what produced the change | lint rules, the contract check, secret scanning, CI               |
| **Agent guardrails** — irreducible              | the configured agent only                        | denied read access to secret paths, confirmation before deploying |
| **Agent accelerators** — never sole enforcement | the configured agent only                        | the layer 0 hook that formats a file after editing it             |

Two rules govern the table:

1. Nothing is enforced _only_ as an agent guardrail unless repository
   tooling genuinely cannot observe it.
2. Nothing in the accelerator row is ever the only thing enforcing
   something. Removing an accelerator must change speed, not correctness.

### The test, which CI already runs

> Delete `.claude/` entirely. Does the repository still enforce every
> correctness rule?

This does not have to be remembered, because **CI is that test**. GitHub
Actions has no `.claude/settings.json` and no agent, so a green CI run is
proof that enforcement does not depend on one. Agent-agnosticism stops
being an aspiration and becomes a property verified on every pull request.

### Layering

- **`AGENTS.md`** is the cross-agent standard and holds instructions any
  agent can act on. Content goes here.
- **`.claude/`** holds Claude-specific _mechanism_ only — permissions,
  hooks, skills. It never introduces a rule that exists nowhere else; it
  only enforces rules already stated in `AGENTS.md` or in repository
  tooling.
- **`CLAUDE.md` is a symlink to `AGENTS.md`**, so the two cannot drift.

**Deny-lists are generated, not maintained per agent.** One list of
secret-bearing paths generates the `.claude/settings.json` deny entries and
the equivalent ignore files other agents honor, with a staleness check
(principles 2 and 3). Adding a path protects every agent at once.

**Committed configuration is team policy; local configuration is personal
preference.** `.claude/settings.json` is committed and reviewed in pull
requests like any other rule. `.claude/settings.local.json` is personal and
must be ignored. Under a Team plan the committed file is shared across
every seat automatically, which is why the deny-list belongs there.

**A gap to close first.** `.claude/settings.local.json` is currently
ignored only by the maintainer's personal global gitignore, and
`.claude/worktrees/` only by `.git/info/exclude`, which is local to one
clone. Neither rule travels with the repository, so a new contributor is
unprotected and would commit personal agent settings on a first pull
request. Both move into the repository's own `.gitignore`.

### Confirmation gates

Operations that are expensive or irreversible — deploying, writing a
secret, applying migrations to production — require confirmation. That is
an agent guardrail, via `permissions.ask`: the risk is in running the
command, and no artifact records it.

It needs a repository-tooling counterpart, though, because a human typing
`wrangler deploy` directly gets no agent gate at all. The same operations
are wrapped in first-class scripts that confirm for humans too. Both
layers, for the same reason the enforcement spine has four.

## Design

### Cross-cutting decisions

**Lint and format: ESLint with typescript-eslint, plus Prettier.** ESLint
is not optional — it is the only mature way to author type-aware custom
rules, and the rules in the table above need type information to express.
`packages/core` reaching a DOM global and a stored value being concatenated
into HTML are both type-directed questions. Prettier rather than Biome for
formatting: `website` already uses Prettier, so track 9 extracts one shared
configuration covering both repositories, and at layer 1 (staged files
only) Prettier costs roughly 300ms, where Biome's speed advantage is not
observable.

**Remote caching: self-hosted on Workers and R2.** Turborepo's cache API is
an HTTP contract and `turbo --api` points at an alternate implementation.
The org runs entirely on Cloudflare; adding a Vercel account and placing
build artifacts with a third party to cache a 21k-line repository is not a
trade worth making. The cache Worker is small and becomes part of the
extracted template in track 9.

**Provisioning: full automation, confirmation before spending or naming.**
Bootstrap creates resources, writes identifiers back into tracked
configuration, and verifies the result. It pauses only for decisions a
machine should not make alone — which Cloudflare account, which domain —
and for the API token itself. Every credential prompt carries the
explain-then-open-the-exact-page-then-prompt pattern ported verbatim from
`website`'s `phases/domain.ts`, not reimplemented.

### Turborepo-first (principle 6)

Every check is a task in the graph. Verified available in the installed
Turborepo 2.10.5:

| Capability             | Use here                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `turbo run check`      | `check` depends on `format`, `lint`, `typecheck`, `test`, `boundaries`, `contract`. `pnpm check` is a thin alias |
| declared `inputs`      | editing `eslint.config.js` invalidates the lint cache and only the lint cache                                    |
| `turbo run --affected` | available, deliberately unused — see below                                                                       |
| `turbo boundaries`     | native package-boundary enforcement; covers part of track 3 without custom rules                                 |
| `turbo generate`       | the engine for principle 2: generators for package, migration, route, rule                                       |
| `turbo watch`          | dependency-aware watch across packages                                                                           |
| `turbo query`          | the workspace-contract check queries turbo's own package graph rather than parsing `pnpm-workspace.yaml`         |

`turbo boundaries` is not listed in `turbo --help` on 2.10.5 but the
subcommand exists and runs. This was verified directly. If a future upgrade
removes it, the custom-rule equivalent in track 3 is the fallback; the two
overlap deliberately.

**`--affected` is available and deliberately not used.** CI runs the whole
`pnpm check`. At this size a cold run is a few seconds and the warm case is
66ms, so the saving is small, while the failure mode is not: the same
workflow is called by the production deploy through `workflow_call`, and a
filter that skipped a package there would let an unvalidated change reach
production. Remote caching is the better answer to the same problem and
does not carry that risk. Revisit if CI time ever becomes the constraint.

`dev`, `preview`, and `worker:dev` stay off the graph, as they are today.
Persistent watch processes gain nothing from caching and the log prefixing
hurts the inner loop (principle 1).

### Track 1 — The enforcement spine

One command defines validity, and one command fixes what it can:

```bash
pnpm check        # format, lint, typecheck, test, boundaries, contract
pnpm check --fix  # everything a machine can repair, repaired
```

Every red CI run maps to exactly one local command. Nobody needs to know
which of six tools complained (principle 1).

Four layers:

| Layer          | Runs                                                        | Blocks on                                  |
| -------------- | ----------------------------------------------------------- | ------------------------------------------ |
| 0 — agent      | `.claude/settings.json` PostToolUse hook on Edit/Write      | nothing; formats the touched file silently |
| 1 — pre-commit | lint-staged: prettier and eslint `--fix`, staged files only | nothing that is fixable; target under 2s   |
| 2 — pre-push   | `pnpm check`                                                | everything                                 |
| 3 — CI         | `pnpm check` plus branch protection                         | everything, authoritatively                |

Layer 0 matters more than its size suggests: an agent's output is
conformant before it reaches a commit, so layer 1 has nothing to report and
the agent never spends a round trip on formatting.

Layer 3 is the guarantee. Layers 0 through 2 are ergonomics, and are
bypassable by design — `--no-verify` exists and people under pressure use
it. Making local hooks unbypassable trains people to work around them,
which is worse than a fast hook they trust (principle 1).

Hooks install through a committed `.githooks/` directory and a `prepare`
script that sets `core.hooksPath`, matching `website` and surviving fresh
clones.

**The workspace contract check.** A script walks the package graph via
`turbo query` and asserts every package declares every required task. This
closes the silent-skip hole: today `apps/worker` has no `verify` script and
CI is green. Afterwards, a package missing a task fails `pnpm check` naming
the package and the script.

**Closing the typecheck blind spot.** `apps/web` gains a second, fully
independent `tsconfig.node.json` leaf covering `scripts/` and config files,
run alongside the existing one. Not project references: `tsc -b --noEmit`
raises TS6310 once a project has outgoing references, which this repository
already hit once. Each tsconfig stays a leaf with its own `noEmit`.

### Track 2 — Test infrastructure

A Vitest workspace with three projects:

- **core** — node environment, no DOM. Most of the checks land here.
- **web** — jsdom, for store and component logic.
- **worker** — `@cloudflare/vitest-pool-workers`: real workerd, real D1
  through miniflare, with migrations from `src/migrations/` applied before
  each run. This takes the Worker from zero coverage to tests exercising
  real SQL against real bindings, and gives track 5 its migration test.

**The migration and its guard.** `scripts/migrate-verify.ts` runs once: it
parses `verify.ts`, groups checks by their existing section comments into
colocated `*.test.ts` files, and rewrites `check(name, cond)` into
`it(name, ...)`.

Three numbers matter here, and they are not the same number. There are
**682 static `check(` call sites**, but **741 assertions execute**, because
some call sites sit inside loops, and those produce **738 distinct names**.
All three were counted during track 1, against the suite as it stands after
its type errors were fixed.

So the guard cannot be a count of call sites. Before the original file is
deleted, the codemod asserts that running the migrated suite produces the
same **multiset** of assertion names as running the original — 741 entries,
738 distinct, matching one for one. A count alone would pass while a looped
case silently collapsed to a single test. The multiset is committed as a
manifest in the migration commit so a reviewer can confirm nothing was lost
at the moment it mattered, then removed in a follow-up commit, leaving it
permanently in history. Silent coverage loss becomes impossible.

**Then the tests are rewritten.** Migrating mechanically first means the
rewrite happens with every assertion already passing in a real runner, so
any behavior dropped during the rewrite shows up as a failure. Rewriting
first would have meant hand-transcribing 741 assertions with nothing
checking the transcription.

What the rewrite addresses, in order of value:

- **`apps/worker` has no tests at all.** This is the largest real gap, and
  the reason the worker project exists in the Vitest workspace. Session
  handling, share creation, the rate limiter, migrations, and every `/api`
  route need coverage against real bindings.
- **Checks that assert on incidental detail** rather than on the rule they
  are named after, which makes them fail on harmless refactors.
- **Missing negative cases.** The existing suite overwhelmingly asserts
  that correct input produces correct output; comparatively little asserts
  that invalid input is rejected, which is where the security-relevant
  behavior lives.
- **Isolation.** `check()` shared one module-level store, so ordering
  dependencies between checks are likely present and currently invisible.
  Running the migrated tests in a randomized order surfaces them.

**Coverage floors** are measured from the result, not guessed. Raising a
floor is a one-line change; lowering one requires a commit showing the
number decrease in the diff.

**Fallout carried by the same change.** `AGENTS.md`'s claim that there is
no test framework becomes false the moment this lands, and is rewritten
here. The `verify` task is renamed `test` across `turbo.json`, root
scripts, CI, `README.md`, and the local development guide.

### Track 3 — Executable conventions and the documentation they point at

ESLint flat config, Prettier, and a local rule plugin implementing the
table in Context. Each rule ships with `meta.docs.url` pointing at a real
page in `docs/`, so an agent that trips a rule and a person who trips the
same rule read the same explanation (principle 1).

`turbo boundaries` covers cross-package import violations natively; custom
rules cover what it can't see, which is the type-directed set.

**`AGENTS.md` is rebuilt around principle 1.** Published measurements put the
performance peak at 100–150 lines with gains reversing past it, a roughly
25% improvement from decision tables that resolve ambiguity, and a roughly
20% degradation from stacked prohibitions offered without a corresponding
fix. Agents pull referenced documents in over 90% of sessions when given a
reason to, which is what makes progressive disclosure work. Sources: the
[AGENTS.md specification](https://agents.md) and Augment Code's [study of
what makes these files help or
hurt](https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files).

**The file is replaced, not edited.** Nothing in the current 108 lines is
carried over for continuity; each rule earns its place in the new file or
moves to a page in `development/`. Rewriting outright is cheaper than
migrating a file whose every section is about to change category, and it
avoids preserving phrasing only because it was already there.

The file becomes an orientation paragraph, the one command, and a table:

| Invariant                             | Why                                                 | Enforced by                 | How                           |
| ------------------------------------- | --------------------------------------------------- | --------------------------- | ----------------------------- |
| `packages/core` runs in both runtimes | core is typechecked against the browser and workerd | `lint: core-runtime-purity` | link to `development/how-to/` |

The **Enforced by** column is the design. A machine-enforced rule doesn't
need to occupy an agent's attention, because the command teaches it on
violation. `AGENTS.md` then spends its budget only on what cannot yet be
automated, and **shrinks as track 3 lands rules**.

**The repository documentation set is authored here.** The "How" column
cannot link anywhere today, because none of these pages exist. They are
written in this track, across the domains defined in the Documentation
layout section:

| Page                                           | Exists to answer                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `development/how-to/run-the-checks.md`         | what `pnpm check` runs, and the fix for each failure                                          |
| `development/how-to/write-a-test.md`           | where tests live, which project, how to run one                                               |
| `development/how-to/add-a-package.md`          | `turbo gen`, and what the contract check requires                                             |
| `development/how-to/add-a-migration.md`        | numbering, the append-only rule, expand and contract                                          |
| `development/how-to/add-an-api-route.md`       | the REST convention and why RPC endpoints are rejected                                        |
| `development/how-to/add-a-lint-rule.md`        | authoring a rule, its test, and its documentation page                                        |
| `development/explanation/architecture.md`      | the pieces, their boundaries, and how they communicate                                        |
| `development/explanation/enforcement-model.md` | these principles, written for a person                                                        |
| `development/explanation/workflow.md`          | branches, pull requests, merge queue, review policy                                           |
| `development/reference/checks.md`              | every check, what it enforces, and its fix command                                            |
| `operations/how-to/deploy-and-roll-back.md`    | what a deploy does and how to reverse it — half of the page `docs/README.md` already promises |
| `operations/how-to/restore-the-database.md`    | the other half: what to do when D1 is wrong or gone                                           |
| `operations/how-to/set-up-from-scratch.md`     | the principle 5 path on an empty Cloudflare account                                           |
| `operations/reference/environments.md`         | what exists in production and what each binding is for                                        |
| `security/how-to/rotate-a-secret.md`           | running the rotation, and what to do after a leak                                             |
| `security/reference/secrets.md`                | every secret, its blast radius, and its rotation command                                      |
| `security/explanation/threat-model.md`         | what we defend against, including the three agent-specific paths                              |

`development/reference/checks.md` is **generated** from the check registry
rather than written by hand, and `pnpm check` fails when it is stale
(principle 2). A check cannot exist without appearing in the human-facing
reference, and the reference cannot drift from the checks.

**The doc-parity check** makes principle 1 executable: `pnpm check` fails if
an invariant row lacks a resolving `docs/` link, if a linked page is
missing, or if a custom rule has no `meta.docs.url`.

As rules become enforced, `AGENTS.md` shrinks while this set grows.
Instruction moves out of the agent-only file and into documentation both
audiences read.

### Track 4 — Right by construction

`turbo generate` generators, each emitting something that already passes
`pnpm check` (principle 2):

- **package** — tsconfig leaf, ESLint config, Vitest project, and every
  task the contract check requires.
- **migration** — the next numbered `.sql` and a test skeleton against it.
- **API route** — REST-shaped per the existing convention, wired into Hono.
- **lint rule** — rule, test, and the `docs/` page its `meta.docs.url`
  points at, so a rule cannot exist without its human door.

### Track 5 — Continuous integration and delivery

This track implements the Development workflow section above. It opens with
a prerequisite that is not code at all: transfer the repository to
`LasVegasForTransit`, without which merge queue is unavailable.

**Repository governance.** A ruleset on `main` disabling direct pushes
including for administrators, requiring `pnpm check`, requiring one
approval, and requiring linear history. Merge queue enabled. CODEOWNERS
routing changes to the right reviewer. The owner bypass described above,
recorded in the ruleset with its removal condition.

**Migrations.** `wrangler d1 migrations apply` runs in the deploy pipeline
after CI passes and before the Worker deploys (principle 5). Local
`pnpm dev` applies pending local migrations automatically (principle 2).
Two checks guard them: an append-only check comparing against `main` that
fails if an already-merged migration file was modified, and an
expand-and-contract check that fails a migration which is not safe against
the previously deployed Worker.

**Delivery.** Per-pull-request preview deployments, a post-deploy smoke
test against the live URL, and automatic `wrangler rollback` when it fails.

**`pnpm ship`**, wrapping branch, commit, push, pull request, and
auto-merge into the single command principle 5 asks for.

### Track 6 — Zero-to-deployed bootstrap

Extends the current three-phase, 59-line CLI to the org standard: install,
workspace, environment, and provisioning phases, resumable state, and a
`--doctor` mode that diffs an existing setup without changing it.

On a fresh Cloudflare account the sequence is: create D1, write
`database_id` back into `wrangler.toml`, apply migrations, deploy the
Worker, bind the custom domain, create the GitHub environment and its
secrets, then smoke-test the live URL (principle 5).

### Tracks 7–9

**7 — Supply chain.** Renovate, dependency audit, pinned action SHAs,
`SECURITY.md`. Secrets moved to their own track; see track 10.

**8 — Documentation validation.** The pages themselves are written in
track 3; this track keeps them true. Link checking across all of `docs/`,
a check that `development/reference/project-structure.md` still matches the
real tree, and the staleness check for generated pages.

**9 — Template extraction.** Move the proven harness into the org's shared
configuration packages and starting template. Last, because a template
should be extracted from something that has survived contact.

### Track 10 — Secret handling for humans and agents

The governing fact is that the secret surface is nearly empty and must stay
that way. The Worker references `SITE_URL` (a var) and the `ASSETS` and
`SHARE_CREATE_LIMITER` bindings; **there are no application secrets in
production today.** The accounts design adds exactly one,
`GOOGLE_CLIENT_SECRET`, and deliberately avoids owning a signing key by
using PKCE with cookie-held verifiers.

The complete inventory is therefore one CI credential and one future OAuth
client secret. This track keeps it that small and handles those two well.
It is not a secrets-management platform, because two secrets do not justify
one.

**Cloudflare OIDC is not available.** Short-lived workload identity for
`wrangler` is an open request against `workers-sdk`, not a shipped feature,
so the CI credential remains a long-lived API token, mitigated by minimum
scope, environment protection, and rotation being a command.

#### The threat model an agent adds

A human leaks a secret by pasting it somewhere. An agent has three
additional exposure paths, and they are the reason this track exists:

1. **Reading.** A secret in a file the agent reads enters model context and
   any transcript or log derived from it.
2. **Arguments.** A secret passed on a command line appears in shell
   history and in the agent's own transcript of the command it ran.
3. **Committing.** An agent that has seen a value can write it somewhere it
   does not belong.

Prompt injection compounds all three: content arriving through a tool
result can attempt to induce an agent holding ambient credentials to
exfiltrate them.

#### Design

**Local development requires no secrets.** The editor already runs fully
without the backend, so the default `pnpm dev` path needs nothing.
Someone working on authentication uses a _development_ Google OAuth
application with its own client secret. **No developer and no agent ever
holds a production credential.** This alone removes most of the exposure.

**Credentials come from browser authentication, never from a paste.**
Bootstrap drives `wrangler login` and `gh auth login`, which are OAuth
flows that deposit tokens in each tool's own credential store. The
credential never enters the repository, the terminal scrollback, the shell
history, or the agent's context. The current bootstrap prompts for a pasted
`CLOUDFLARE_API_TOKEN`; the fix is to stop prompting.

**The CI token is minted and installed without being displayed.** Using the
already-authenticated session, bootstrap creates a scoped token through the
Cloudflare API and pipes it directly into the GitHub environment secret via
`gh secret set` reading from stdin. It is never rendered to the terminal,
never written to disk, and never passed as an argument. No human and no
agent sees the value. _(Requires confirming that Cloudflare's token-creation
API accepts the scopes needed; verify before relying on it, and fall back
to the guided-creation walkthrough from `website`'s `phases/domain.ts` if
not.)_

**Agents are denied read access to secret-bearing paths.**
`.claude/settings.json` carries `permissions.deny` entries for
`.dev.vars`, `.env*`, key material, and `wrangler`'s credential store, so
the values cannot enter context in the first place. The harness enforces
this; nothing relies on the prompt. The same list is
mirrored into the ignore files other agents honor, and is documented as
needing extension whenever a new secret-bearing path appears.

**Secrets are never passed as command arguments.** `wrangler secret put`
reads from stdin; a lint rule rejects scripts that interpolate a secret
into `argv`.

**Three nets catch a committed secret**, because the first two are
bypassable: secret scanning in the pre-commit hook, the same scan in CI
where it is authoritative, and GitHub push protection, which is free on
public repositories.

**A checked inventory.** `security/reference/secrets.md` lists every secret,
where it lives, who can read it, its blast radius if leaked, and the
command that rotates it. `pnpm check` fails when Worker code reads an
environment value absent from the inventory and the Zod environment schema,
so a new secret cannot be introduced silently.

**Rotation is a command.** `pnpm secrets:rotate <name>` mints the
replacement, installs it, and revokes the old one.

## Testing

Each track is verified by the harness it adds:

- Track 1: `pnpm check` passes on a clean tree; a deliberately broken file
  fails it with a message naming the fix. A package created without a
  required task fails the contract check by name. `scripts/` typechecks,
  with all nine errors catalogued above fixed rather than suppressed, and
  the two typecheck configurations reconciled so they agree about core's
  source. `pnpm preflight` detects a `node_modules` tree that disagrees with
  the lockfile and repairs it.
- Track 2: the codemod's own guard — the same multiset of 741 assertion
  names, 738 distinct, asserted before
  the original is deleted. `pnpm test` passes across all three projects.
  Worker tests execute against real D1 with migrations applied.
- Track 3: each custom rule ships with fixture tests covering a violation
  and a compliant case. The doc-parity check fails when a rule's
  `meta.docs.url` is removed, and when an `AGENTS.md` invariant row links
  to a page that does not exist. `development/reference/checks.md`
  regenerates byte-identically, and editing it by hand fails the staleness
  check. Each authored guide is verified by having someone who has not done
  the task follow it and succeed without asking a question.
- Track 4: each generator's output passes `pnpm check` unmodified. This is
  asserted in CI, so a generator cannot rot into emitting invalid code.
- Track 5: a migration merged together with code depending on it deploys
  correctly. The append-only check fails when an existing migration is
  edited, and the expand-and-contract check fails a migration that drops a
  column the currently deployed Worker still reads. A direct push to `main`
  is rejected. Two pull requests that are green independently but conflict
  semantically are caught by the merge queue rather than by `main` going
  red. A deliberately failing smoke test triggers a rollback, and the
  previous version serves traffic afterwards.
- Track 6: verified on a genuinely empty Cloudflare account, timed, from
  `git clone` to a responding production URL.
- Track 10: a secret committed to a branch is rejected by the pre-commit
  hook, by CI when the hook is bypassed, and by GitHub push protection. An
  agent instructed to read `.dev.vars` is refused by the harness. Worker
  code reading an environment value missing from
  the inventory fails `pnpm check`. Rotation is exercised for real: rotate
  the CI token, confirm a deploy still succeeds, confirm the previous
  token no longer authenticates.

## Sequencing

Tracks 1 and 2 ship together; the spine is meaningless without a real test
runner behind it. Tracks 3 through 6 each stand alone and are separately
reviewable. Track 9 comes last by definition.

Track 10 splits. Its three nets against a committed secret cost little and
belong in track 1, alongside the hooks they attach to, because the window
where they are most needed is the one before the rest of this exists. The
remainder — minting, inventory, rotation — lands with track 6, where
bootstrap is already handling credentials.

One item may be pulled ahead of everything: the missing
`wrangler d1 migrations apply` in the deploy pipeline is a live production
risk today, and is roughly twenty lines. It can ship as a standalone fix
before track 1 begins.
