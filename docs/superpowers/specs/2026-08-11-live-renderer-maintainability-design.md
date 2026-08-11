# Live Renderer Maintainability Design

## Purpose

The renderer redesign must improve the experience of using TransitMapper and the experience of maintaining it. Performance machinery is not successful if a maintainer has to reconstruct the rendering lifecycle from dozens of exported interfaces.

This design keeps the behavior already built for screen-space detail, incremental projection, and atomic scene publication, but presents it through a small domain vocabulary and one obvious runtime entry point.

## The model a maintainer should learn

The geographic renderer has five concepts:

1. **Presentation** describes the camera, viewport, display scale, and detail thresholds.
2. **Projection** turns an immutable transit system into visible renderer features.
3. **Scene** is the complete, stable-ID result of a projection.
4. **Bank** is one of two physical MapLibre copies used to publish a scene without showing a partial revision.
5. **Editor overlay** is short-lived interaction geometry such as handles, termini, and junction guides. It is not part of the committed scene.

Scheduling, indexes, diffs, source uploads, and settlement are implementation details beneath those concepts. They may have focused modules, but they are not separate public subsystems.

## Public web boundary

`MapCanvas` owns the MapLibre map and translates React/store events into
renderer input. It creates one `LiveMapRenderer`. The facade speaks in the
objects a maintainer cares about rather than exposing its jobs and adapters:

```ts
renderer.projectDocument(request);
renderer.publishScene(sceneUpdate);
renderer.updateEditorScene(editorUpdate);
renderer.requestRecovery();
renderer.snapshot();
renderer.dispose();
```

`DocumentProjector` is owned by that facade and turns a document/camera request
into a private scene update. `MapCanvas` may decide _when_ a document or camera
change needs rendering, but it does not assemble preparation jobs, source-bank
transactions, scene diffs, or accepted-scene state.

## Runtime flow

For a document or invalidating-camera change, the runtime performs one readable transaction:

```text
classify change
    -> prepare reusable indexes
    -> project affected domains
    -> assemble the next immutable scene
    -> stage it in the inactive MapLibre bank
    -> wait for the staged bank to be renderable
    -> switch visible and interaction ownership together
    -> publish the accepted revision
```

Each stage operates on private draft state. Until the final switch succeeds, the prior scene remains visible and interactive. A failure aborts the draft and leaves the accepted scene unchanged.

A camera movement that remains within the prepared candidate envelope skips projection entirely. Hover, filters, and selection halos mutate MapLibre state without rebuilding committed geometry. Selection handles, service termini, and junction guides are rebuilt only by the editor-overlay path.

## Module boundaries

The web renderer lives under `apps/web/src/map/`. Its public concepts have
obvious filenames; focused algorithm modules remain beside their owner rather
than being hidden behind a second directory hierarchy:

| Area                                             | Responsibility                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `live-map-renderer.ts`                           | The accepted-scene lifecycle facade used by `MapCanvas`                               |
| `document-projection.ts`                         | Preparation, scoped projection, cancellation, and generation accounting               |
| `scene-draft.ts`, `scene-draft-*.ts`             | Normalize projected features, apply scoped ownership, and build a private scene draft |
| `scene-publication.ts`, `scene-publication-*.ts` | Stage source data, activate a bank, roll back failures, and report settlement         |
| `source-bank.ts`, `source-bank-*.ts`             | Logical-to-physical source/layer identity, resident revisions, and bank settlement    |
| `editor-feature-state.ts`                        | Paint-only selection, hover, halos, and selected-route focus                          |
| `editor-overlays.ts`                             | Selection-dependent handles, service termini, and junction guides                     |
| `cooperative-render-job-scheduler.ts`            | The shared cooperative execution policy                                               |

An implementation detail stays in the module that owns it unless at least two responsibilities need it. One-use option interfaces, result wrappers, and re-export-only contract modules are removed. Names describe domain meaning, not construction history: `scene draft` instead of `staged live render work`, and `scene publication` instead of a chain of source update plans and submission adapters.

Core continues to own browser-free rendering truth: `RenderPresentation`, dependency and viewport indexes, projection geometry, stable render identities, `RenderScene`, and `RenderScenePatch`.

## Explanation standard

Every public renderer module starts with a short explanation of:

- what it owns;
- what it deliberately does not own;
- the invariant that makes the boundary necessary.

Comments explain constraints, such as why a source bank must be prewarmed or why a draft cannot publish before its hit data. Comments do not narrate loops or restate type names.

The architecture and project-structure documentation provide the complete lifecycle. A maintainer should not need test files or performance reports to discover the basic design.

## Testing

Tests are organized around observable lifecycle rules:

- a failed draft never changes the accepted scene;
- camera reuse performs no committed projection;
- a scoped document edit preserves unrelated scene identity;
- editor overlays never enter committed source banks;
- visible layers and hit queries switch to the same revision;
- settlement resolves only after the accepted revision can paint.

Algorithm-focused tests remain near their implementation, but they use the vocabulary above. Tests should not enshrine incidental adapter call order unless that order protects a documented invariant.

## Migration constraints

This is a behavior-preserving refactor of the completed Phase 2 work. It does not add Tasks 3–7 renderer features. The migration proceeds from the outside inward:

1. establish the `LiveMapRenderer` boundary and remove renderer orchestration from `MapCanvas`;
2. group and rename existing internals beneath the semantic modules;
3. delete superseded adapters and narrow public interfaces;
4. update tests and documentation to use the domain vocabulary;
5. verify behavior with serialized, single-process checks.

If an existing abstraction does not fit this model, it must justify itself with a distinct invariant. Otherwise it is folded into its owning semantic module.
