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

The document a new contributor reads first. It explains what the system is,
what its parts are called, and why it is shaped the way it is. Someone who
has read it can open any directory and know what they are looking at.

Evergreen, meaning it survives refactors and renames. That constrains which
names it uses rather than forbidding names outright:

| Include                                             | Exclude                                |
| --------------------------------------------------- | -------------------------------------- |
| Workspace package names                             | Paths to individual files              |
| Domain type and concept names                       | Function and variable names            |
| The technologies a component is built on            | Version numbers and configuration keys |
| Orders of magnitude, where a limit drove a decision | Exact measurements                     |

Both halves matter. A document naming no packages and no domain concepts
cannot be mapped onto the repository, and explains nothing to the person it
exists for. A document naming files stops being true at the next rename.

| Section        | Contents                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| Context        | The system, its users, its external dependencies. Diagram.               |
| Domain model   | The core abstractions and the distinction the design turns on            |
| Components     | `###` per component, titled with its package name                        |
| Flows          | `###` per end-to-end path, as a sequence                                 |
| Decisions      | `###` per decision: chosen, rejected, and the constraint that decided it |
| Trust boundary | Where untrusted input enters, and what constrains it                     |
| Failure modes  | Table: what fails, what degrades, what stays up                          |
| Invariants     | Table: invariant, and the property it preserves                          |
| Unwired code   | Complete but unimported capability, and what is absent                   |

Domain model comes second because the vocabulary is a prerequisite for
everything after it. A reader who does not know what the nouns mean cannot
follow the components that manipulate them.

Decisions record why this system rather than a different one, including
what was rejected. A document holding only the outcome cannot stop the
rejected option being proposed again.

Diagrams are Mermaid, so they render in a browser and diff as text.

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
