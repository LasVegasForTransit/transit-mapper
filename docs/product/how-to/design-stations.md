# Design Stops and Stations

TransitMapper keeps two related passenger-place concepts separate:

- A **Stop** is the physical point where passengers board or alight.
- A **Station** is an optional named place or complex containing one or more Stops.

A roadside bus Stop does not need a Station. A rail terminal can have one
Station with several platform Stops. A Service calling at a Stop is derived
from its path and stopping pattern; it is not another place to maintain.

## Place Stops in Network

Choose the **Stop** tool (`S`) in Network, then click on or near a Line. The
Stop snaps to the underlying Way and follows it when the alignment changes.
Select the Stop to name it, set dwell time, mark it as major, or attach it to
a Station.

## Draw a Station in Infrastructure

Choose the **Station** tool (`S`) in Infrastructure, then:

- drag a rectangle around the passenger place, or
- click its corners and double-click to close (`Esc` cancels).

The boundary belongs to the Station, not to any one Stop. Select it to rename
the Station, add platform geometry, attach existing Stops, or reshape the
boundary by dragging its handles.

Deleting a Station does not delete its Stops. They become standalone boarding
points so removing a place label or boundary cannot silently remove service.

## Add facilities and larger complexes

Facilities such as entrances, elevators, buildings, and bus bays remain
separate physical features. Drawing one inside a Station boundary associates
it with that passenger place through a group. Use a separate facility-complex
boundary when several Stations or unrelated facilities form one larger site.

## Import behavior

GTFS platform or boarding records become Stops. A `parent_station` record
becomes a Station, and child Stops link to it. Feeds without parent-station
hierarchy import Stops only; TransitMapper does not invent Station complexes.
