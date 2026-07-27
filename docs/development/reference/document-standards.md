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

One document per repository that lets a competent stranger find the right
place to make a change, and know what that change must not break.

Its readers, in order: a new contributor with a specific task, a returning
maintainer who has forgotten a boundary, a reviewer deciding whether a diff
belongs where it landed. It is not a system description for management, an
API reference, or a record of history.

Every section passes one admission test. Omitting it would cause a competent
newcomer either to put code in the wrong place, or to break something the
compiler and the test suite will not catch. Nothing else is admitted.

#### Sections

Fixed order. R is required in every repository; C is conditional on the
stated trigger.

| Section          |     | What the reader does with it                                     |
| ---------------- | --- | ---------------------------------------------------------------- |
| Context          | R   | Decides whether this repository is where the change belongs      |
| Domain model     | R   | Reads any identifier and knows what it means                     |
| Code map         | R   | Given "I need to change X", opens the right package              |
| Runtime topology | C   | Learns which runtime constraints apply to the code being touched |
| Flows            | R   | Traces one operation end to end; knows where to break first      |
| Invariants       | R   | Learns what the change must not break, and what catches it       |
| Decisions        | R   | Stops re-proposing an alternative already rejected               |
| Trust boundary   | C   | Learns which code treats its input as hostile                    |
| Failure modes    | C   | Learns which dependencies are allowed to be load-bearing         |
| Absences         | C   | Stops hunting for code that is not there                         |

Triggers for the conditional sections:

- **Runtime topology** — when build units and run units differ: more than one
  deployable, or one build unit running in more than one runtime. Omitted
  when every package maps to one process in one runtime.
- **Trust boundary** — when the repository processes input authored by
  someone other than the person running it.
- **Failure modes** — when dependencies can fail independently at runtime.
- **Absences** — only when one exists. Never write "none".

A pure library has six sections and often fits on one screen. That is
correct rather than deficient.

#### Budgets

Bloat is a failing check rather than a matter of taste.

| Limit            | Value                                |
| ---------------- | ------------------------------------ |
| Whole document   | 1,500 words soft, 2,500 hard         |
| Code map entries | 12                                   |
| Decisions        | 8, each naming what was rejected     |
| Diagrams         | 2, Mermaid, container level or above |

The heading set is closed. Those ten are the only `##` headings permitted,
spelled exactly, in that order. An unrecognised heading fails the check,
which is what keeps filler out: there is nowhere to put it.

#### Naming

The document must survive a rename that changes no behaviour.

| Tier           | Applies to                                                                               |
| -------------- | ---------------------------------------------------------------------------------------- |
| Name freely    | Domain concepts, workspace package and deployable names, wire nouns, technologies        |
| Name sparingly | Top-level source directories, and a single entry-point file where the file is the module |
| Never name     | Paths inside a package, functions, variables, config keys, versions, exact measurements  |

Name things so a reader can find them by symbol search. Do not link to
source files: links go stale, names do not.

The test: if a behaviour-preserving rename would falsify a sentence, that
sentence is at the wrong altitude.

#### Excluded

| Excluded                               | Reason                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Directory tree or file inventory       | Derivable from the source tree and stale at the first rename. It belongs in project-structure.md |
| Class or module diagrams               | An IDE generates them on demand                                                                  |
| A diagram per scenario                 | Flows covers the two to four paths that matter                                                   |
| API lists, schema columns, config keys | Reference material with a different half-life                                                    |
| Setup, build, and test instructions    | README and CONTRIBUTING                                                                          |
| Roadmap and planned work               | The fastest-rotting content in any repository                                                    |
| History of what was used before        | The decision log, with superseded records kept                                                   |
| Quality goals and risk registers       | Unfalsifiable. A real constraint appears as an invariant                                         |
| Stakeholder tables                     | Ceremony. The stakeholder is a contributor                                                       |
| Dependency inventories                 | The lockfile is the truth                                                                        |
| Exact benchmark numbers                | Orders of magnitude only, and only where a limit forced a decision                               |

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
