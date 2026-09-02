# TransitMapper V2 engine

## Reader and purpose

This document is for a developer who will implement or review the V2 engine. After reading it, that
developer can name every responsibility in the engine, say which other responsibilities it may rely
on, and decide where a new piece of behaviour belongs without asking.

It describes responsibilities and the rules governing them. It does not name packages, files,
functions, or tools, because those change without the design changing. It assumes the reader has
read [Design principles](../../product/explanation/design-principles.md), whose rules V2 keeps.

## Prior decisions

V1 is disposable. V2 carries no obligation to reach feature parity, and the current application is a
reference rather than a migration target.

Four problems force a rewrite rather than continued work on the existing model. The map library V1
renders through cannot give V2 a scene it controls. Fixed record types have to become entities
carrying components, so that a new kind of thing is data. The pipeline that turns the model into map
features caps both frame budget and system size. The engine has to run outside a browser.

The first milestone is the entity-component model, with the existing map library kept as the
renderer. Owning the renderer comes later.

## Scope

This document covers the engine: how state is stored, how the domain is modelled, how state changes,
how geometry is derived, and what the renderer receives.

It does not cover the simulation model, the editor interface, the desktop shell, persistence, or
networking. Each of those is a separate design that depends on this one.

## Programs and seam

V2 is two programs separated by one seam.

The engine owns the world. That is every entity, every component, the definitions of which kinds
exist, all derived geometry, the record that undo reads from, and later the simulation.

The host owns the environment. That is the display surface, the interface tree, the renderer's
lifecycle, pointer and keyboard input, and every call that leaves the machine.

The rule placing code on one side or the other is mechanical, because a rule requiring judgement
erodes under deadline. Code needing a display surface or a socket belongs to the host. Code that is
state, or a function of state, belongs to the engine. There is no third category, and convenience is
not a reason to move something.

The host keeps no copy of the world. It holds which entity is selected, what the camera is doing,
and transient interface state such as whether a dialog is open. Mirroring component data into the
host creates a second source of truth and removes the reason for the design.

Three kinds of data cross the seam.

| Direction          | Payload                            | Magnitude         |
| ------------------ | ---------------------------------- | ----------------- |
| Host to engine     | Change requests                    | Tens of bytes     |
| Engine to host     | A description of one entity        | Hundreds of bytes |
| Engine to renderer | Encoded map geometry, opaque bytes | Kilobytes         |

The world itself never crosses in either direction.

## Responsibilities

The engine is nine responsibilities. Each is a module in the abstract sense: a unit with one
purpose, a stated interface, and a fixed set of things it is allowed to rely on.

| Responsibility | Question it answers                | May rely on                   |
| -------------- | ---------------------------------- | ----------------------------- |
| Geometry       | Where is this shape?               | Nothing                       |
| Storage        | Where does this data live?         | Nothing                       |
| Catalog        | What kinds of thing can exist?     | Nothing                       |
| Presentation   | How is a kind drawn?               | Catalog                       |
| World          | What is true right now?            | Storage, Catalog, Geometry    |
| Change         | How does the world become another? | World                         |
| Output         | What does a renderer receive?      | World, Presentation, Geometry |
| Facade         | What can a host ask for?           | Every responsibility above    |
| Adapters       | How does a host reach the engine?  | Facade only                   |

## Layering

A responsibility may rely only on those above it in that table. The compiler rejects a cycle on its
own, but it accepts a downward reliance that violates the ordering, so the ordering is checked
automatically rather than reviewed by eye.

Two results follow, and they are the reason the ordering is shaped this way.

World cannot rely on Presentation, so domain logic cannot read a colour or a stroke width. The
separation of style from domain, which contributors currently hold in their heads, becomes something
the build rejects.

Nothing relies on Adapters. The engine has no knowledge that a browser exists, which is what makes a
native build an additional adapter rather than a second engine.

## Separation of concerns

Each responsibility answers one question. A change that does not fit the question belongs somewhere
else.

| Responsibility | Content that does not belong                         |
| -------------- | ---------------------------------------------------- |
| Geometry       | Anything naming a way, a lane, or a station          |
| Storage        | Anything naming a transit concept                    |
| Catalog        | A colour or a stroke width                           |
| Presentation   | A lane width in metres, which is a domain property   |
| World          | A tile coordinate or an encoding format              |
| Change         | Geometry mathematics                                 |
| Output         | Any mutation of the world                            |
| Facade         | Any logic at all; it delegates and does nothing else |
| Adapters       | Any decision the engine could have made for itself   |

The test for a new unit is whether its purpose can be stated without the word "and". A unit
described as geometry and labels is two units.

## Inverted dependencies

The engine needs four things it cannot produce. For each, the engine states what it requires and an
adapter supplies it. The direction of reliance points from the adapter toward the engine, never the
reverse.

| Requirement          | Supplied by an adapter as            |
| -------------------- | ------------------------------------ |
| The current time     | A clock the engine reads through     |
| Randomness           | A seeded source, so a run repeats    |
| Kind definitions     | A loader returning catalog data      |
| Diagnostic reporting | A sink the engine writes warnings to |

The justification is concrete rather than stylistic. Reading the wall clock directly through the
standard library is unavailable on the WebAssembly target: an engine that does it compiles, passes
every test on a development machine, and fails the first time it runs in a browser. Stating the
requirement moves that decision to the adapter, which is the only part that knows where it is
running.

Four requirements is the complete list. A new one is added when a second implementation exists, or
when the first cannot work on a target the engine must support. A requirement is not added because a
type might one day vary.

## World model

### Entities, components, and systems

An entity is an identity and nothing else. It has no fields and no behaviour.

A component is a fact about an entity, held as plain data. A way is an entity carrying its control
points, its kind, and its cross-section. A station is an entity carrying its anchor, its kind, and
its name. No type named "way" exists.

Storage groups entities by which components they carry, so a rule reading two components walks a
contiguous run of them. That grouping is the performance argument for the model. Being able to give
an entity a new fact without editing a type is the flexibility argument.

A system is a rule deriving new facts from existing ones. Systems read components and write
components. A system never calls another system, because that would hide the ordering.

### Identity

Two identities exist and they are not interchangeable.

The storage handle is an index the storage layer chooses for itself. It is compact and fast, and it
does not survive a save and reload. It never leaves the World responsibility.

The durable identity is assigned when an entity is created and is never reused. It survives
serialization, and every outward-facing surface uses it: change requests name it, entity
descriptions carry it, rendered features are keyed by it, and the host's selection refers to it.

World owns the translation in both directions. Any outward-facing operation accepting a storage
handle is a defect.

### Recorded and derived facts

Recorded facts are authored. They are what a person edited and what a saved document contains:
control points, curve settings, kind references, cross-sections, names, shared-name membership,
junction membership, station anchors, the stretches of way a pattern covers, headway and span, and a
service's own colour.

A service's colour is a domain fact rather than a presentation fact, because the red line is part of
that line's identity. This exception is inherited from V1 and is documented in the design
principles.

Derived facts are computed by systems: the resolved path of a way after smoothing and junction
trimming, its cumulative lengths, its per-lane geometry, a junction's footprint, and each entity's
bounding box.

Derived facts are never authored, never serialized, and never edited. A change request writes
recorded facts only. This preserves the V1 rule that a value which can be computed is not also
stored.

### Kinds as data

A way type is an entry in the catalog, not a case in the type system. Logic reads properties from a
catalog entry and never branches on which entry it received. Branching on a kind identity anywhere
outside the Catalog responsibility is a defect, because it means adding a mode would require finding
and editing that branch.

### Derivation order

Systems run as an explicit ordered sequence after each batch of changes, because an ordering that
emerges from data structure layout produces different results on different runs.

1. Resolve each way's path from its control points and curve setting
2. Solve each junction, producing trim distances and a footprint
3. Shorten each resolved path where it meets a junction
4. Measure cumulative lengths and bounding boxes
5. Lay out per-lane geometry from the cross-section
6. Place each station along the way it is anchored to
7. Insert bounding boxes into the spatial index

## Change

The host never mutates the world. It submits a change request, which is data describing an intent:
create a way of some kind along some points, move one control point, replace a cross-section, delete
an entity. One request corresponds to one editor action.

Applying a request returns a change set: which entities were touched, and the bounding box enclosing
the change. A change set has two consumers. The host learns which parts of the inspector to re-read.
Output learns which rendered geometry is stale.

Undo records the prior value of every recorded fact a request overwrites, and restores those values.
The alternative, deriving an inverse for each kind of request, is more logic and offers more ways to
be quietly wrong, and the recorded prior values for a single edit are small.

Direct mutation is closed off deliberately. It would produce two sources of truth, no undo, and no
way to know which rendered geometry changed.

## Reading

The inspector needs the current state of the selected entity. A read returns a description of one
entity: its recorded facts plus the derived values the interface displays, such as total length.
Descriptions are small enough that their encoding cost does not matter.

No read returns geometry for the map. Map geometry reaches the screen only as rendered output.

## Output

Output reads derived facts and the spatial index and produces encoded map geometry for a requested
region and detail level. The renderer decodes it directly, so world data is never reconstructed as
host-language objects.

Staleness comes from the change set's bounding box. The current renderer cannot invalidate one
region at a time, so the host reloads what is on screen. Regenerating visible regions from a warm
index is far cheaper than reprocessing the whole network, but it is not the same as regenerating
only what changed, and that gap is a known limitation rather than a design goal.

Print output shares everything except the final encoding. Both paths read the same derived facts, so
a printed map cannot disagree with the screen. One derivation path is what makes a preview truthful.

## Determinism

Every part of the engine is deterministic. The same sequence of change requests produces the same
world and the same rendered bytes on every run and every platform. Only adapters may be
non-deterministic, because only they touch the outside.

| Not permitted                           | Used instead                         |
| --------------------------------------- | ------------------------------------ |
| Reading wall-clock or elapsed time      | The supplied clock                   |
| Ambient randomness                      | The supplied seeded source           |
| Iterating an unordered collection       | An ordered collection, or sort first |
| Parallel work combined in arrival order | A fixed combination order            |

Determinism serves three goals at once. A planning result can be reproduced and defended. A recorded
session replays. A test can assert on exact output rather than on tolerances.

## Verification

Every responsibility is verifiable without a display surface, which preserves the property that the
repository's checks need no browser.

| Responsibility | What its tests establish                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Geometry       | Invariants over generated input, such as offsetting by a distance and back |
| Catalog        | Well-formed definitions load and malformed ones are rejected               |
| World          | A sequence of changes produces the expected derived facts                  |
| Change         | Applying then undoing returns the world to an identical state              |
| Output         | Decoded output contains the expected features, never byte equality         |
| Facade         | Scripted sessions produce the expected descriptions                        |

The comparison used by the undo test is also the determinism test. Running one script twice and
comparing the resulting worlds catches an unordered traversal that no individual assertion would.

The format crossing the seam is pinned by a fixture both sides load. Generated type definitions
catch a renamed field; only a shared fixture catches a field whose meaning changed.

## Constraints

The engine is compiled ahead of time from a language the host does not share. Two consequences
follow and neither is avoidable.

The repository's single verification command currently requires no network. A compiled toolchain
fetching dependencies on first use removes that property. This is a deliberate cost.

The seam's format has two implementations in two languages. They can drift, and only the shared
fixture prevents it.

## Open questions

How durable identity is generated and encoded is unsettled. A counter is simplest and collides when
two people edit one document; a random value does not collide and costs more bytes in every rendered
feature. This has to be answered before the first milestone, because changing it later invalidates
every saved document.

Whether the rendered encoding can express lane-level detail is unmeasured, since it quantises
coordinates to a grid. Some detail may have to reach the renderer another way at close zoom.

Invalidation granularity depends on renderer behaviour that may change. If reloading visible regions
proves too expensive, the alternative is a deeper integration with the renderer than a request
handler.

Where the simulation lives is unresolved. It relies on World and is probably its own responsibility,
but what it needs to store and how it is scheduled are unknown until the model is designed.

Which storage implementation to adopt is unresolved. The Storage responsibility exists so the
decision can be revisited, but a first choice has to be made and measured against a realistic
network.
