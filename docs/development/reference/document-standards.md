# Document standards

Required documents and their required sections. Applies to every repository
the organization maintains. `pnpm check` fails when a required document is
missing or lacks a required top-level section.

## Rules

### Headings

Noun phrases naming their contents. Not questions, not sentences, not
claims. `Runtimes`, not `Why core must run in two runtimes`.

Nest. A section covering several things gets one `###` per thing, rather
than paragraphs separated by transitions.

Required sections are `##`. Their order is fixed. A section with nothing to
record is omitted, not retitled.

### Prose

Declarative and specific. No preamble, no restatement of the heading, no
address to the reader.

Numbers carry units and provenance: `10ms CPU limit per request`, not `a low
CPU limit`.

## Required documents

### `development/explanation/architecture.md`

Evergreen. It describes the shape of the system and survives refactors,
renames, and hosting changes.

It contains no file names, no measurements, no configuration keys, and no
function names. Those belong to `project-structure.md`, `operations.md`, and
the code, and each invalidates this document the moment it changes.

The test: renaming every file in the repository leaves this document true.

| Section        | Contents                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| Context        | The system, its users, and the external systems it depends on. Diagram.                    |
| Components     | `###` per component: responsibility, and what it does not own                              |
| Flows          | `###` per end-to-end path, as a sequence                                                   |
| Decisions      | `###` per decision: what was chosen, what was rejected, and the constraint that decided it |
| Trust boundary | Where untrusted input enters, and what constrains it                                       |
| Failure modes  | Table: what fails, what degrades, what stays up                                            |
| Invariants     | Table: invariant, and the property it preserves                                            |
| Unwired code   | Complete but unimported capability, and what is absent                                     |

Components and flows describe the system as built. Decisions record why it
is that system rather than a different one, including options rejected — a
document that only describes the outcome cannot stop the rejected option
being proposed again next quarter.

Diagrams are Mermaid, so they render in the browser and diff as text.

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
