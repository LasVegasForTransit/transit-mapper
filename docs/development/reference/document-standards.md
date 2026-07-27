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
by restating its heading, and reference documents do not address the
reader.

Numbers carry units and provenance: `10ms CPU limit per request`, not `a low
CPU limit`.

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

| Section                | Contents                                                 |
| ---------------------- | -------------------------------------------------------- |
| Tree                   | Directory tree, one line per entry                       |
| _per source directory_ | `##` per directory: its files and their responsibilities |

`check:structure` enforces the per-directory sections in both directions.

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

| File              | Contents                                |
| ----------------- | --------------------------------------- |
| `README.md`       | What the project is, quick start, links |
| `AGENTS.md`       | Invariants table; what is unenforced    |
| `CONTRIBUTING.md` | How to contribute, and where to start   |
| `SECURITY.md`     | Reporting a vulnerability; scope        |
| `LICENSE`         | The license                             |
