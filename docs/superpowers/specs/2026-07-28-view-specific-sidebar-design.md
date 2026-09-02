# View-specific editor sidebar

## Context

The left sidebar currently renders every service, way, station, facility, and group in one flat
list. That resembles a graphics editor's layers panel, but it exposes TransitMapper's storage model
rather than the way people work in its three views. It is especially poor for imported systems,
where nobody wants to browse thousands of road segments.

The right inspector remains the only selection-dependent editing surface. This change affects
navigation and presentation controls only.

## Design

The sidebar follows the active view and keeps its sections independently collapsible. Switching
views changes the working set completely; objects from other views do not remain in a secondary
list.

### Network

A small control at the top of the scrollable area switches between grouping the network by **Lines**
and by **Corridors**.

- Lines expand into their patterns when a service has branches, then into the stops called at in
  travel order. A stop is a service role; its row uses the existing derived stop list and selects
  the permanent station that hosts it.
- Corridors are a UI projection, not a new domain entity. Existing `NamedWay` records form named
  corridors; service-carrying ways outside a named identity appear as simple fallback corridors.
  Each corridor expands into the lines using it and the permanent stations anchored to it.
- Vehicles is an independently collapsible placeholder. This change does not create durable
  simulated-vehicle identities.

### Infrastructure

The physical workspace contains:

- **Corridors**: existing named physical identities only, not every junction- split way or imported
  road segment.
- **Stations**: permanent station records, with platform counts where present.
- **Complexes and facilities**: footprint-bearing groups and standalone facilities. Generic
  footprint-less groups are not exposed as a storage-model category.

### Diagram

Diagram is read-only, so its sidebar controls presentation instead of exposing editable objects. It
reuses the existing view state for mode visibility and landmarks. No new document fields or
visibility model are introduced.

## Interaction and scale

Expansion and grouping are local presentation state and reset on reload. Every section is
independent; opening one never closes another. Large leaf lists keep the existing 150-row cap and
explicit “show more” affordance. Selectable rows remain native buttons inside one labelled
keyboard-navigation region. This preserves select-and-focus and roving arrow-key behavior without
putting disclosure buttons, section controls, and “show more” actions inside a listbox.

## Testing

Pure outline derivation is covered in ordinary Vitest tests: ordered line stops, named-corridor
aggregation, unnamed service-carrying fallback corridors, and exclusion of unrelated roads.
Component tests cover the three view structures and the Vehicles placeholder. `pnpm check` remains
the completion gate.
