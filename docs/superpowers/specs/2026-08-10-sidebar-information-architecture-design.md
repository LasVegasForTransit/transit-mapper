# Sidebar information architecture and transit vocabulary

## Context

The left panel currently puts a system name above a collapsible **Workspace**
heading, repeats the active view name below it, and then asks people to group
the Network view by **Lines** or **Corridors**. The hierarchy describes neither
the canvas nor the transit system clearly. The panel's upper-right action also
uses a plain square for a global Hide UI command, so it does not communicate
either its appearance or its effect.

The terminology underneath that interface is also overloaded. The stored
`Service` owns a public name and color, one mode and schedule, and one or more
route patterns. The sidebar calls those records Lines. Its Corridors option is
a computed grouping of service-carrying physical ways, even though a corridor
is more naturally the geographic area around a proposed or existing line that
someone studies for access, land use, alternatives, and investment.

This design makes the left panel a view-specific outline, separates a public
Line from a technical Service, and stops using Corridor until the future land
use engine gives the concept real meaning.

## Goals

- Make the panel's organization obvious to someone new to both TransitMapper
  and transit planning.
- Follow the active top-level view without adding a second navigation hierarchy.
- Give Line, Service, Stop, and Station distinct functional meanings.
- Preserve a compact default for the common one-line/one-service case while
  revealing operational detail when it matters.
- Keep selection-dependent editing in the right inspector.
- Preserve current scale, keyboard, touch, and responsive guarantees.

## Non-goals

- Do not introduce a Corridor record, boundary, layer, empty sidebar section,
  or disabled future affordance.
- Do not design the land use engine or a fourth Planning view.
- Do not expose internal geometry fragments or route-pattern terminology merely
  to make the object model visible.
- Do not introduce durable simulated vehicles as part of the sidebar work.
- Do not turn the left panel into a second property editor.

## Vocabulary

The product uses these meanings in interface copy, documentation, model
comments, imports, and tests:

- **System** is the complete document: its public lines, operating services,
  physical infrastructure, passenger places, and presentation.
- **Network** is the connected set of paths and places across which
  transportation operates.
- **Mode** is the physical means of transportation, such as bus, rail, ferry,
  bicycle, or aerial transit.
- **Line** is the public identity a transportation agency designates on a map.
  It owns the rider-facing name, color, and future symbol or short code. The
  agency decides what belongs to that identity.
- **Service** is one technical operating unit within a line. It has exactly one
  mode, a path and stopping pattern, a vehicle type, and a schedule or
  frequency. Changing vehicles or modes normally means changing services.
- **Branch**, **express**, **short turn**, and **substitute shuttle** describe
  the role of a service within a line; they are not parallel structural types.
- **Trip** or **run** is one scheduled vehicle journey providing a service.
- **Stop** is a durable physical boarding or alighting point. A simple roadside
  Stop stands alone; a platform Stop can belong to a Station.
- **Station** is an optional named passenger place containing one or more Stops.
  It can own a boundary and platform geometry, but is not required for every Stop.
- **Service call** is the relationship between one Service and one Stop. It is
  derived from the Service path and stopping pattern except where the Service
  explicitly skips that Stop.
- **Infrastructure** is the physical roads, tracks, guideways, paths, stations,
  and facilities that services use.
- **Pattern**, **way**, **leg**, and similar geometry terms remain internal
  implementation vocabulary unless a specialized editing action genuinely
  requires one of them.

A proper name does not determine an object's functional type. A service named
“DART Orange Line” can still appear as a Service beneath a public Line because
that is the agency's proper name for it.

### Corridor is reserved

A **Corridor** will eventually mean a named geographic study area: the area
around a proposed or existing line considered for land use, access, cost,
alternatives, and investment. Its boundary and contents depend on the planning
question, so it is not an automatic parent of infrastructure, lines, or
services. Until the land use engine defines and uses that record, Corridor does
not appear in the everyday editor.

## The three top-level views

Network, Infrastructure, and Diagram remain the global projections of one
system. The view switcher changes the canvas and the outline together. The
sidebar does not repeat the active view as `Workspace -> Network` or add another
set of tabs that competes with the global switcher.

| View               | Question it answers                            | Outline contents                                                                                         |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Network**        | What can people ride, and how does it connect? | Lines, services when needed, stops, and a separate Stations section                                      |
| **Infrastructure** | What physically exists and supports movement?  | Named roads, railways or guideways, trails and other catalog nouns, then Stops, Stations, and Facilities |
| **Diagram**        | How is the network communicated to riders?     | Lines, services when needed, stops, and Stations as represented in the schematic                         |

Network and Diagram share concepts but retain independent expansion, search,
scroll, and presentation state. Diagram stays read-only. Infrastructure lists
named real-world facilities rather than every junction-split geometry record.
Large or unnamed technical fragments remain selectable from the canvas and
editable in the inspector without flooding the outline.

Selection survives a view change when the concept remains meaningful. A Line
selected in Network remains selected in Diagram. Switching to Infrastructure
highlights the roads, tracks, platforms, and facilities supporting that Line,
but does not relabel those physical objects as the Line or silently replace the
selection with one of them.

## Panel structure

The desktop panel has three stable regions:

1. A document header containing the TransitMapper menu trigger, editable system
   name, and left-panel collapse control.
2. A compact **Outline** toolbar containing search and, when useful, a
   collapse-all action.
3. The scrollable outline for the active view.

The generic Workspace disclosure and the oversized repeated view title are
removed. The current Lines/Corridors grouping control is removed rather than
renamed.

The menu trigger uses the TransitMapper mark with a disclosure indicator so it
reads as a menu. The upper-right button uses an actual panel-collapse icon and
collapses only the left panel. The global Hide UI action moves into the menu and
keeps its keyboard shortcut; a local panel control must not unexpectedly hide
the inspector, toolbar, and other chrome.

On compact layouts, the outline begins directly with search and content; it
does not spend vertical space repeating “Network outline,” “Infrastructure
outline,” or “Diagram outline.” The same semantics are used across desktop and
compact layouts.

## Outline hierarchy

### Network and Diagram

Lines are the primary rows. Selecting a Line selects its public identity;
renaming or recoloring it happens in the right inspector.

A Line containing one ordinary Service compresses that redundant level. Its
disclosure reveals Service calls, labeled by Stop, while the inspector exposes the underlying
Service's mode, vehicle, path, and schedule. Accessible names for the Line and
its call rows include the Service context needed to understand them; they do
not claim that a visually omitted Service row is present. Compression is
presentation, not data loss.

A Line containing multiple Services reveals them as children. Service rows use
specific labels such as “Downtown local,” “Airport express,” or “Construction
shuttle,” and carry mode or role metadata needed to distinguish them. Expanding
a Service reveals its calls at Stops. A Line whose Services share a mode can show that
mode on the Line row; a mixed-mode Line shows a summary such as “2 modes”
instead of claiming that the Line itself has one mode.

A single Service may omit its own name because the Line already supplies the
public label. Once a Line has multiple Services, every Service needs a distinct
display label. The editor asks for one when adding a Service. Import and
migration prefer a supplied branch name or headsign, then derive a label from
distinct termini, and use a stable ordinal such as “Service 2” only when the
source contains no meaningful distinction.

Stops and Stations also appear in separate top-level sections because both are
saved physical places, not properties of whichever Line happens to be expanded.
A call row beneath a Service selects that Service-at-Stop context. A top-level
Stop row selects the boarding point itself; a Station row selects its containing
passenger place and exposes the attached Stops and calling Services.

### Infrastructure

Infrastructure uses the catalog's real-world nouns rather than a generic
Corridors bucket or the internal `Way` type. Sections are present only when the
system contains that family: Roads, Railways or Guideways, Trails, Waterways,
and other supported infrastructure, followed by Stations and Facilities.
Shared named identities group their physical segments. Raw segments are not
listed as peers merely because they exist in storage.

The existing Vehicles placeholder is removed from every view. Simulated
vehicles remain a canvas presentation until they have durable identities and
real navigation or editing behavior.

## Interaction details

- Clicking a row selects and focuses its object. A disclosure control only
  expands or collapses; it never changes selection as a side effect.
- Hovering a row highlights its representation on the canvas without changing
  durable selection.
- The first canvas click selects the understandable public Line. A direct
  Service row click, Enter/deep-selection command, or explicit **Edit service**
  action descends to the operational object.
- Search filters the active outline only. Matching descendants retain enough
  ancestors to explain their context. If a hidden single Service is the direct
  match, search temporarily reveals its Service row rather than presenting a
  match with no explanation.
- Each view remembers its own search query, expansion, and scroll position for
  the session. These are local presentation state and are not serialized into
  the transit document.
- Multi-selection follows list conventions already used by the editor. The
  outline never makes disclosure buttons or utility actions members of the
  selectable option set.
- Empty sections state the next meaningful action, such as “Draw a line to
  begin,” rather than leaving a blank panel or showing model terminology.
- Large lists retain bounded initial rendering and an explicit Show more
  affordance. Search operates over the full logical collection, not only the
  currently rendered slice.
- Focus indicators, roving keyboard navigation, screen-reader relationships,
  touch targets, and reduced-motion behavior remain equivalent across desktop
  and compact layouts.

## Line and Service model

The document gains separate public Line and operational Service records. The
relationship has one authoritative stored direction:

```ts
interface Line {
  id: string;
  name: string;
  color: string;
  serviceIds: string[];
}

interface Service {
  id: string;
  name?: string;
  modeId: string;
  vehicleKindId?: string;
  path: ServicePath;
  frequencyMinutes?: number;
  spanStart?: string;
  spanEnd?: string;
  schedule?: SchedulePeriod[];
}
```

`TransitSystem` stores ordered `lines` and `services` collections. A Line's
`serviceIds` determines membership and order; Service does not also store a
`lineId`. Validators enforce that every referenced Service exists and that
every Service belongs to exactly one Line. Creation always produces a Line and
its first Service atomically. Removing the only Service is expressed as
deleting the Line, so the editor cannot leave an empty public identity behind.

Each Service owns one path with outbound and inbound runs. The existing Pattern
geometry becomes that internal `ServicePath`; multiple current Patterns become
multiple Services under one Line. This makes schedule, mode, fleet, and stops
attach to the unit that actually operates them. Future short turns or express
variants become additional Services rather than exceptions inside one public
record.

Line color is the default color for all its Services and is what the public map
renders. A per-Service color override is not introduced by this change.

### Module boundaries and data flow

`packages/core` owns Line, Service, and ServicePath types; document migration
and validation; lookup helpers; and pure projections such as Lines with their
ordered Services and derived Stops. Those functions accept document data and
return plain values without browser state.

`apps/web` owns active-view state, local search/expansion/scroll state, hover
highlighting, and the translation from a projected outline row to an editor
selection command. The outline component renders the projection it receives;
it does not infer membership by walking the document or mutate the document
directly. The inspector receives the resulting Line, Service, Stop, Station, or
infrastructure selection through the existing editor store and remains the
only property-editing surface.

The flow is one-way:

```text
TransitSystem + active view
  -> pure view-specific outline projection
  -> search and presentation-state projection
  -> accessible outline rows
  -> explicit editor selection command
  -> right inspector and canvas highlight
```

This boundary keeps hierarchy, migration, and transit semantics testable
without a browser while leaving focus, scrolling, and pointer behavior in the
web application.

## Creation and editing

The Lines tool remains one beginner-facing action. Drawing creates a Line and
its first Service together, selects the Line, and puts public name and color in
the Line inspector. The same inspector contains a compact summary of the sole
Service and an **Edit service** action for mode, vehicle, path, stops, and
schedule.

When a Line has more than one Service, the Line inspector summarizes them and
offers **Add service**. Service creation starts from a deliberate choice—new
branch, express or short-turn variant, or substitute operation—without forcing
those labels into the durable type system. A Service can choose a different
mode because mode belongs to Service, not Line.

The right inspector remains the only dynamic editing surface. The left outline
does not sprout inline schedule, mode, or property controls.

## Document migration and imports

A new document-schema migration performs a deterministic split:

- Each current `Service` becomes one Line with the same public name and color.
- A current Service with one Pattern creates one new Service beneath that Line.
- A current Service with multiple Patterns creates one new Service per Pattern,
  preserving Pattern order and optional names. Missing names follow the same
  headsign, termini, then stable-ordinal fallback used by imports.
- Generated Services inherit the current mode, vehicle kind, headway, span, and
  detailed schedule. The migration does not guess that two old Patterns have
  different operations.
- Existing references are audited by meaning. References to public map identity
  move to Line; references to an operational path move to the generated Service.
  No reference is silently dropped or pointed at whichever generated record
  happens to come first.

The GTFS importer maps an agency route or equivalent public map designation to
a Line and creates distinct Services for its meaningful route and stopping
patterns. Mode and imported service levels attach to Services. Import tests
cover routes with several patterns and prove that the sidebar does not flatten
them into unrelated Lines.

## Failures and recovery

The interface must not expose partially migrated or structurally invalid
Line/Service relationships. Parsing either repairs a relationship
deterministically or rejects the document with the existing recoverable load
failure path; it never renders a Line whose controls operate on a missing
Service.

An outline derivation failure cannot take away the canvas or the rest of the
editor. The affected section presents a concise retryable failure while other
sections and the right inspector continue to work. Search and hover are
presentation enhancements and must not mutate the document if interrupted.

## Documentation changes

Implementation updates the guides and explanations that currently call every
stored Service a line, including the view, simulation, routing, import, and
getting-started documentation. Project structure records the Line/Service
boundary and the outline derivation layer. Model comments explain why public
identity is separate from mode-specific operation. Corridor references are
kept only where they describe the reserved future planning concept or ordinary
English geography, not the removed sidebar projection.

## Verification

Pure model tests cover:

- Line and Service membership invariants;
- document migration for one- and multi-pattern records;
- preservation of names, colors, modes, paths, schedules, stop behavior, and
  references;
- GTFS import into Lines with ordered Services; and
- selection projection between public Lines, operational Services, and
  supporting infrastructure.

Component and interaction tests cover:

- the view-specific Network, Infrastructure, and Diagram outlines;
- removal of Workspace, the Lines/Corridors toggle, and the Vehicles
  placeholder;
- direct Stop expansion for a single-Service Line;
- explicit Service rows for multi-Service and mixed-mode Lines;
- search revealing normally compressed Service context;
- hover highlighting, selection continuity, deep selection, and inspector
  routing;
- bounded large-list rendering and full-collection search;
- keyboard, screen-reader, touch, compact-sheet, reduced-motion, and panel
  collapse behavior; and
- the menu-hosted global Hide UI action and its existing shortcut.

`pnpm check` remains the completion gate for the eventual implementation.
