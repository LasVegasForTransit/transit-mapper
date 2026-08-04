# TransitMapper documentation

> TransitMapper is in open beta and changes frequently. These docs track the
> editor as it exists today; where a feature is planned but not built, the
> docs say so.

The documentation follows the [Diátaxis](https://diataxis.fr/) framework:
tutorials teach, how-to guides solve, reference informs, explanation
deepens.

## Tutorials

- [Getting started](product/tutorials/getting-started.md) — from an empty map to a
  small working system: streets, a rail line, stations, and a bus route.

## How-to guides

- [Set up a local development environment](development/how-to/local-development.md) —
  clone, install, run, and what to check before a pull request.
- [Draw and edit roads](product/how-to/draw-roads.md) — presets, lanes, one-way
  streets, divided carriageways, street names.
- [Work with intersections](product/how-to/edit-intersections.md) — automatic
  junctions, turn lanes, signals, grade separation.
- [Design stations](product/how-to/design-stations.md) — station land, buildings,
  platforms, bus bays, complexes.
- [Route services over infrastructure](product/how-to/route-services.md) —
  snap-to-streets drawing, adopting existing ways under a sketch.
- [Import streets from OpenStreetMap](product/how-to/import-osm.md).
- [Share and export](product/how-to/share-and-export.md) — read-only links, forking,
  PNG export.
- [Run TransitMapper in production](operations/how-to/operations.md) — deploy, roll
  back, apply a migration, restore the database, and what to do when the
  Worker breaks.

## Reference

- [Data model](product/reference/data-model.md) — every record in a saved system.
- [Editor interactions](product/reference/editor-interactions.md) — normative
  vocabulary, pointer cursors, badges, previews, and results.
- [Catalogs](product/reference/catalogs.md) — way types, modes, lane kinds,
  facility types, presets, and how to extend them.
- [Keyboard shortcuts](product/reference/keyboard-shortcuts.md).
- [Project structure](development/reference/project-structure.md) — what lives where in
  the source tree.

## Explanation

- [The three views](product/explanation/views.md) — Network, Infrastructure,
  Diagram, and why "the Infrastructure view is 2D" is a hard rule.
- [Design principles](product/explanation/design-principles.md) — catalog-driven
  kinds, style/domain separation, menus versus modes.
- [Geometry and routing](product/explanation/geometry-and-routing.md) — how lane
  offsets, junction footprints, and the route graph are derived.
- [The simulation](product/explanation/simulation.md) — the simulated clock, why the
  simulator holds no state, and what that buys and costs.
- [Sharing surfaces](product/explanation/sharing-surfaces.md) — drawing a system
  without a map, and how preview images, embeds and oEmbed fit together.

## Developing TransitMapper

For people changing the code rather than using the app.

- [Run the checks](development/how-to/run-the-checks.md) — what `pnpm check`
  does, and the fix for each failure.
- [Measure browser performance](development/how-to/measure-performance.md) —
  the fixed Chrome protocol, hard gates, baselines, offline proof, and leak soak.
- [Update application icons](development/how-to/update-application-icons.md) —
  generate browser assets, export Apple's Liquid Glass icon, and publish an
  installed-app identity update.
- [Write a test](development/how-to/write-a-test.md) — the two suites, and
  which one new work belongs in.
- [Add a package](development/how-to/add-a-package.md) — the generator, and
  what the workspace contract requires.
- [Add a migration](development/how-to/add-a-migration.md) — numbering, the
  append-only rule, and writing one that is safe to roll back past.
- [Add a lint rule](development/how-to/add-a-lint-rule.md) — authoring one,
  testing the near-misses, and when not to write one at all.
- [Commit messages](development/reference/commit-messages.md) — the standard
  the commit-msg hook enforces.
- [Secrets](security/reference/secrets.md) — every secret, its blast
  radius, and how to rotate it.
- [Architecture](development/explanation/architecture.md) — what the pieces
  are and which boundaries are load-bearing.
- [Checks](development/reference/checks.md) — every check, what makes it
  fail, and the command that fixes it.
- [Performance acceptance matrix](development/reference/performance-acceptance-matrix.md) —
  automated gates and the manual browser/failure-path release checklist.
- [The enforcement model](development/explanation/enforcement-model.md) —
  why the harness is shaped this way.

Design documents for larger pieces of work live in
[`superpowers/specs/`](superpowers/specs/).
