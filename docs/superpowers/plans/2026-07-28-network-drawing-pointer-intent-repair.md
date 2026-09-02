# Network drawing and pointer-intent repair

## Goal

Repair the current V1 Network editor so service-path editing is distinct from physical-corridor
editing, every modifier-driven pointer action is visible before press, and right-click actions
operate on the exact displayed point.

## Global constraints

- Follow `AGENTS.md`; new browser-independent logic belongs in `packages/core` and every new
  behavior starts with a failing test.
- Do not change the persisted schema. `Way`, `Node`, and `Station` stay unchanged when a service
  terminus is edited unless the user explicitly creates corridor topology.
- Network view edits service paths through dedicated service-terminus handles. It never exposes a
  selected service's physical corridor control points.
- A complete gesture is one undo checkpoint. Preview, cancel, an invalid drop, or `Escape` must not
  partially mutate the system.
- Connections between lines require exact `Service.modeId`. Explicit connections may traverse every
  corridor type allowed by that mode; automatic corridor-crossing junctions remain exact-type only.
- Do not create a station automatically when lines connect.
- Use these labels exactly: **Divide line here**, **End line here**, **Convert end to two one-way
  paths**, and **Split corridor here**.
- The longer half of a divided branch stays in the original service. The shorter half becomes
  `<existing name> 2`, receives an unused color, and is selected.

## Task 1: Pure service-path editing and store operations

Add browser-independent model helpers and tests for positions and terminus edits, then route the
store's line actions through them.

- Represent an exact hit on one pattern/run/leg, including its way-relative `t` and distance through
  the run. Repeated use of the same way must produce distinct positions.
- Extend either terminus by materialized route legs without changing ways, nodes, stations, service
  identity, color, schedule, or sibling branches. A split/couplet pattern gains a shared outer
  section.
- Closing `A-B-C` with `C-D-B` produces shared `A-B`, split outbound `B-C`, and split inbound
  `C-D-B`. A zero-length or disconnected closure returns a refusal and the original pattern.
- Resolve **End line here** by evaluating valid trims from both endpoints and keeping the greater
  total operating-path length. Resolve repeated corridors by exact occurrence, not nearest way id.
- Divide only the focused pattern. Preserve sibling branches on the original service, preserve the
  longer half there, and return the shorter half for the store to mint as `<name> 2` with a new
  color.
- Add or update store actions with return values that let interaction code distinguish commit from
  refusal. Preserve existing couplet behavior.
- Tests must prove ways and stations retain object identity/coordinates during service-only
  extension, both terminus sides work, sibling branches are unchanged, loop sections are correct,
  repeated-way cuts select the requested occurrence, longest-side ending works, and division does
  not split a way.

Run the focused core tests and the web store verification cases touched by the change.

## Task 2: Pure pointer-intent resolver and cursor badge

Create a pure editor-layer resolver whose output controls both pointer presentation and dispatch.

- Public editor-only types: `PointerTarget`, `ModifierState`, `ArmedInteraction`, and
  `PointerIntent`.
- Inputs include view, tool, target, modifiers, read-only state, diagram state, armed operation, and
  whether a gesture is active.
- Outputs include the primary operation, native CSS cursor, optional badge, whether it is allowed,
  and which anchor/preview kind to show.
- Modifier grammar:
  - `Space`: camera pan.
  - `Shift`: constrain or add to the active operation.
  - `Alt/Option`: erase, remove, or deliberately keep separate.
  - `Ctrl/Cmd`: structural alternate, specifically split or extend.
- Keydown/keyup recomputes idle intent without requiring mouse movement. Pointer-down locks the
  primary operation; only `Shift` may change a geometric constraint after a drag starts.
- Render a pointer-transparent badge beside the native cursor with existing iconography. It clears
  on target leave, tool/view change, menu close, gesture finish/cancel, or read-only transition.
- Add literal, table-driven tests for this reference, plus intent locking and stationary-pointer
  modifier changes:

| Context               | Target or modifier           | Cursor               | Badge          | Primary operation         |
| --------------------- | ---------------------------- | -------------------- | -------------- | ------------------------- |
| Any editable view     | `Space`                      | `grab` or `grabbing` | none           | Pan                       |
| Network Select        | Empty                        | `grab`               | none           | Pan                       |
| Network Select        | Line body                    | `default`            | none           | Select line and branch    |
| Network Select        | Service terminus             | `grab`               | extend         | Extend branch             |
| Network extending     | Same branch interior         | `grabbing`           | loop           | Close directional loop    |
| Network extending     | Same-mode line               | `grabbing`           | connect        | Connect paths             |
| Network extending     | Different-mode line          | `not-allowed`        | none           | Refuse                    |
| Network Line          | Compatible corridor          | `crosshair`          | connect        | Route service             |
| Network Line          | Empty                        | `crosshair`          | new            | Draw service and corridor |
| Network Line          | `Alt/Option`                 | `crosshair`          | separate       | Draw separate corridor    |
| Network armed return  | Return terminus              | `crosshair`          | one-way return | Draw inbound side         |
| Network               | Right-click line             | `default`            | none           | Open line actions         |
| Network               | Right-click terminus         | `default`            | none           | Open terminus actions     |
| Infrastructure Select | Control point                | `grab`               | move           | Move point                |
| Infrastructure Select | Control point + `Shift`      | `grab`               | constrain      | Constrained move          |
| Infrastructure Select | Control point + `Alt/Option` | `grab`               | erase          | Erase point(s)            |
| Infrastructure Select | Interior point + `Ctrl/Cmd`  | `default`            | split          | Split corridor            |
| Infrastructure Select | Endpoint + `Ctrl/Cmd`        | `grab`               | extend         | Extend corridor           |
| Infrastructure        | Right-click corridor         | `default`            | none           | Open corridor actions     |
| Read-only or Diagram  | Editable target              | `not-allowed`        | none           | Refuse edit               |

Run the focused web Vitest file and typecheck the web package.

## Task 3: Service terminus handles, branch focus, and action anchors

Separate service-path affordances from physical corridor handles.

- Derive a dedicated terminus feature for both ends of every pattern in the selected service. Each
  feature carries service id, pattern id, side, and mode id.
- Add transient active-pattern state. Clicking a rendered line resolves and focuses the nearest
  pattern occurrence; clicking a Pattern row focuses that pattern. Coincident termini expose only
  the focused pattern as interactive.
- In Network view a service selection renders service termini and zero corridor control points.
  Infrastructure view retains corridor handles.
- Give terminus handles their own source/layer and higher interaction priority than service and
  corridor lines.
- Add a transient action-anchor source/layer at the resolved right-click position. Keep it visible
  while the menu is open; clear it on action, dismissal, tool/view change, or `Escape`.
- Pass a resolved pattern/run/leg position into point action providers so they never re-project onto
  a nearby corridor independently.
- Rename the infrastructure action to **Split corridor here**. Right-clicking a line exposes
  **Divide line here** and **End line here**; right-clicking a terminus exposes **Convert end to two
  one-way paths**.
- Tests must prove a Network service selection produces no corridor handles, every branch can be
  focused, terminus features identify their branch and side, terminus hit-testing wins, and the
  visible anchor equals the action position.

Run the relevant source-projection, upload-plan, action-registry, interaction, and store
verification tests.

## Task 4: Terminus gestures, loops, return paths, and line connections

Wire the resolved pointer intent to transactional Network gestures.

- Plain-drag a service terminus to run a stateless legal path query and preview it with the existing
  route, sharing, and endpoint-hint overlays. Dropping commits the Task 1 service edit; failure
  changes nothing.
- Dragging a terminus onto the interior of the same branch commits the directional loop described in
  Task 1 and renders one-way arrows on both sides.
- **Convert end to two one-way paths** arms an ephemeral return-path operation from that exact
  terminus even when Select remains the toolbar tool. The terminus and cursor show the
  one-way-return state. A valid reconnect commits a split section; invalid drop or `Escape` changes
  nothing.
- Dropping on a different line requires exact mode equality. An interior target connects paths while
  preserving both services. A target terminus opens an anchored choice:
  - **Connect paths** extends the dragged line and leaves the target unchanged.
  - **Join into a through-service** keeps the dragged service's identity, schedule, and color and
    absorbs the target service.
- Explicit connection may create a junction between different corridor types only when the dragged
  mode allows every involved type. Automatic crossings remain exact-type.
- Every commit is one undo step. The connection chooser mutates nothing until a choice is selected.
- Tests cover stationary stations, all supported mode families, same-mode mixed-corridor connection,
  different-mode refusal, self-loop closure, through-service choice, return-path arming from Select,
  cancel/refusal, and undo identity.

Run focused model/web tests and web typecheck.

## Task 5: Normative reference and full acceptance

Add `docs/product/reference/editor-interactions.md`, link it from `docs/README.md`, and update the
route guide, keyboard reference, project structure, Route inspector copy, and relevant prior design
notes.

The vocabulary table must define:

| Term                    | Definition                                              | Current model representation       | Explicitly not                      |
| ----------------------- | ------------------------------------------------------- | ---------------------------------- | ----------------------------------- |
| Line / service line     | Named, colored transit service                          | `Service`                          | Road, track, or drawn polyline      |
| Branch                  | One operating variant                                   | `Pattern`                          | Service direction                   |
| Service path            | Ordered corridors one branch follows                    | `PatternSection[]`, `PatternLeg[]` | Physical geometry owned by the line |
| Outbound / inbound path | One direction through a service path                    | `RunDirection`                     | Corridor point order                |
| Terminus                | Operational start or end of one branch                  | Derived from its service path      | Corridor endpoint                   |
| Corridor                | Physical road, track, path, aerial span, or water route | `Way`                              | Transit service                     |
| Control point           | Authored point shaping a corridor                       | `Way.points[index]`                | Junction, station, or terminus      |
| Corridor endpoint       | First or last corridor control point                    | First/last `Way.points` entry      | Service terminus                    |
| Junction                | Topological connection between corridors                | `Node`                             | Visible crossing or control point   |
| Station                 | Passenger stop or station                               | `Station`                          | Junction                            |
| Handle                  | Temporary draggable editing grip                        | Derived UI feature                 | Saved network data                  |
| Action anchor           | Temporary right-click location marker                   | Ephemeral overlay                  | Inserted network node               |
| Connection              | Explicit joining operation                              | Editor operation                   | Generic name for every point        |

The pointer table must document the implemented cursor, badge, preview, and result for: Space pan;
Network empty/select/terminus/self-loop/same-mode and different-mode targets; Line tool over
compatible/empty/Alt-separated ground; armed return path; line and terminus right-click;
Infrastructure control point, Shift constraint, Alt erase, Ctrl/Cmd split, Ctrl/Cmd corridor
extension; right-click corridor; and read-only/Diagram refusal.

Run `pnpm check`. Then exercise a browser acceptance matrix for bus, light rail, and heavy rail:
branch focus, both terminus extensions, directional loop, divide, longest-preserving end, return
conversion, both connection choices, modifier cursor changes without pointer motion, action-anchor
placement, cancellation, and undo.
