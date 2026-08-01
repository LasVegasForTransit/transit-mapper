# Document standards

Required documents and their required sections. Applies to every repository
the organization maintains. `pnpm check` fails when a required document is
missing or lacks a required top-level section.

## Rules

### Headings

A heading is a noun phrase naming its contents. `Runtimes` is a heading;
`Why core must run in two runtimes` is a sentence.

Nest. A section covering several things gets one `###` per thing, rather
than paragraphs separated by transitions.

Required sections are `##`. Their order is fixed. A section with nothing to
record is omitted, not retitled.

### Prose

Sentences are complete, declarative, and specific. A section does not open
by restating its heading, and reference documents do not address the reader.

Numbers carry units and provenance: `10ms CPU limit per request`, not `a low
CPU limit`.

Write plainly. Say the thing, in the shortest sentence that still says it.

| Rule              | Instead of                                             | Write                               |
| ----------------- | ------------------------------------------------------ | ----------------------------------- |
| Active voice      | `A junction is formed where ways cross`                | `A junction forms where ways cross` |
| No hedging        | `This is arguably the main constraint`                 | `This is the main constraint`       |
| Ordinary words    | `leverage`, `utilize`, `facilitate`                    | `use`, `use`, `let`                 |
| No fake formality | `It is important to note that migrations are additive` | `Migrations are additive`           |
| Cut filler        | `In order to keep costs low, we`                       | `To keep costs low, we`             |
| Plain structure   | `The reason it works is that the core is pure`         | `It works because the core is pure` |
| No stock metaphor | `the load-bearing detail`, `at its core`               | Name the detail                     |

Vary the construction. A page where every other sentence turns on `rather
than` or an em-dash reads as filler even when each sentence is true. If a
phrase appears three times on one page, two of them are habit.

`check:documents` rejects a fixed list of stock phrases. It catches the
obvious ones only; the rest is on the author and the reviewer.

## Required documents

### `development/explanation/architecture.md`

[arc42](https://arc42.org/overview), complete. All twelve sections, in
order, with the official names.

#### Sections

| Section                      | Contents                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Introduction and Goals    | Requirements overview, three to five prioritised quality goals, stakeholder table        |
| 2. Architecture Constraints  | Technical, organizational, and convention constraints that restrict design               |
| 3. Context and Scope         | Business context and technical context: partners, channels, and what is out of scope     |
| 4. Solution Strategy         | The decisions that shape everything else, mapped to the quality goals they serve         |
| 5. Building Block View       | Static decomposition, level 1 then level 2 per building block                            |
| 6. Runtime View              | Scenarios showing building blocks interacting                                            |
| 7. Deployment View           | Infrastructure, environments, and the mapping of software onto them                      |
| 8. Crosscutting Concepts     | Concepts spanning multiple building blocks: domain model, persistence, security, testing |
| 9. Architecture Decisions    | Decisions expensive enough to record, each naming what was rejected                      |
| 10. Quality Requirements     | A quality tree, and scenarios making each goal falsifiable                               |
| 11. Risks and Technical Debt | Known risks and debt, with current status                                                |
| 12. Glossary                 | Domain and technical terms used when discussing the system                               |

The heading set is closed. Those twelve are the only `##` headings
permitted, spelled exactly, in that order. An unrecognised heading fails the
check.

Every section is required. A section with nothing to record is a finding
about the project rather than licence to drop the heading: an empty Risks
and Technical Debt means nobody has looked, and an empty Glossary means the
vocabulary is undocumented.

A word limit of 5,000 catches runaway. The closed heading set, not the
limit, is what keeps filler out.

#### Naming

The document must survive a rename that changes no behaviour.

| Tier           | Applies to                                                                              |
| -------------- | --------------------------------------------------------------------------------------- |
| Name freely    | Domain concepts, workspace package and deployable names, wire nouns, technologies       |
| Name sparingly | Top-level source directories, and an entry-point file where the file is the module      |
| Never name     | Paths inside a package, functions, variables, config keys, versions, exact measurements |

Name things so a reader can find them by symbol search. Do not link to
source files: links go stale, names do not.

The test: if a behaviour-preserving rename would falsify a sentence, that
sentence is at the wrong altitude.

#### Excluded

Content belonging to another document, regardless of which arc42 section it
might seem to fit:

| Excluded                              | Belongs in                              |
| ------------------------------------- | --------------------------------------- |
| Directory tree or file inventory      | `project-structure.md`                  |
| Setup, build, and test instructions   | `README.md` and `CONTRIBUTING.md`       |
| Operational procedure and runbooks    | `operations.md`                         |
| Secret inventories and rotation       | `secrets.md`                            |
| API endpoint lists and schema columns | Reference documentation beside the code |
| Roadmap and planned work              | `ROADMAP.md` and the issue tracker      |

### `development/reference/project-structure.md`

The document is organized by ownership, not by literal directory names.

| Level  | Contents                                                                |
| ------ | ----------------------------------------------------------------------- |
| `##`   | Workspace groups: Workspace, Packages, Applications, Repository support |
| `###`  | A package, application, or repository-support area beneath its group    |
| `####` | An internal module beneath the package or application that owns it      |

`Workspace` contains dependency direction and the navigation tree. `Packages`
and `Applications` explain responsibility, dependencies, runtime constraints,
and ownership boundaries. Source paths appear as short locator notes within
their owning sections; paths and filenames do not become headings.

Filename-led inventories are excluded. A file is named only when it is an
entry point, generated artifact, or external contract whose identity matters
to the explanation. `check:structure` enforces the group hierarchy and
bidirectional coverage between workspace modules and source directories.

### `development/explanation/enforcement-model.md`

| Section       | Contents                                      |
| ------------- | --------------------------------------------- |
| Bar           | The single command, and what it covers        |
| Layers        | Table: layer, what runs, what it blocks       |
| Placement     | Repository tooling versus agent configuration |
| Rules         | `###` per repository-specific rule            |
| Adding a rule | Required steps                                |

### `development/reference/checks.md`

Generated from a registry. Not hand-written.

### `operations/how-to/operations.md`

| Section    | Contents                               |
| ---------- | -------------------------------------- |
| Deploy     | Trigger, and what it does              |
| Roll back  | Command, and its limits                |
| Migrations | When they apply relative to deployment |
| Restore    | Recovering the data store              |
| Incidents  | Where logs are; what to check first    |

### `security/reference/secrets.md`

| Section    | Contents                                    |
| ---------- | ------------------------------------------- |
| Inventory  | Table: secret, location, blast radius       |
| Rotation   | `###` per secret                            |
| Prevention | What stops a secret reaching the repository |
| Rules      | Handling constraints                        |

### Root files

| File                 | Contents                                          |
| -------------------- | ------------------------------------------------- |
| `README.md`          | What the project is, quick start, links           |
| `AGENTS.md`          | Invariants table; what is unenforced              |
| `CONTRIBUTING.md`    | How to contribute, and where to start             |
| `SECURITY.md`        | Reporting a vulnerability; scope and support      |
| `SUPPORT.md`         | Product, organization, security, and media routes |
| `CODE_OF_CONDUCT.md` | Community standards and private enforcement path  |
| `LICENSE`            | The software license                              |
