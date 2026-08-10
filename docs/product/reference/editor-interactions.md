# Editor interactions

This is the normative vocabulary and pointer-intent reference for the editor.
User-facing copy uses the terms below. Code and model documentation may name
the TypeScript representation when that distinction helps a maintainer.

## Vocabulary reference

| Term                    | Definition                                               | Current model representation       | Explicitly not                     |
| ----------------------- | -------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| Line                    | Name and color an agency designates on its public map    | `Line`                             | A mode, schedule, or physical path |
| Service                 | One mode-specific operation beneath a Line               | `Service`                          | A cross-mode operation             |
| Service path            | The one ordered path a Service operates                  | `ServicePath`                      | Physical infrastructure itself     |
| Outbound / inbound path | One direction through a Service path                     | `RunDirection`                     | Way point order                    |
| Terminus                | Operational start or end of one Service                  | Derived from its Service path      | Way endpoint                       |
| Way                     | Physical road, track, trail, aerial span, or water route | `Way`                              | Line or Service                    |
| Control point           | Authored point shaping a Way                             | `Way.points[index]`                | Junction, Station, or terminus     |
| Way endpoint            | First or last control point of a Way                     | First/last `Way.points` entry      | Service terminus                   |
| Junction                | Topological connection between Ways                      | `Node`                             | Visible crossing or control point  |
| Station                 | Physical passenger place                                 | `Station`                          | A Service call                     |
| Stop                    | A particular Service calling at a Station                | Derived from path and Station data | A duplicate physical Station       |
| Handle                  | Temporary draggable editing grip                         | Derived UI feature                 | Saved network data                 |
| Action anchor           | Temporary right-click location marker                    | Ephemeral overlay                  | Inserted network node              |
| Connection              | Explicit joining operation                               | Editor operation                   | Generic name for every point       |

Use **junction** in the interface and user guides. Use `Node` only when
describing the saved representation or a code identifier. A visible crossing
is not a junction until the Ways share topology.

## Pointer-intent reference

The native cursor and its badge are one contract with the operation dispatched
on pointer-down. Modifier changes recompute an idle pointer's intent without
requiring the pointer to move. Once pointer-down starts a gesture, its primary
operation is locked; only `Shift` may add or remove a geometric constraint.

`None` in the Preview column means the interaction does not draw a live
geometry preview. A **target cue** marks the object the operation will use. An
**action anchor** is the persistent right-click marker defined above.

| Context               | Target or modifier           | Cursor               | Badge            | Preview                                           | Result                                                   |
| --------------------- | ---------------------------- | -------------------- | ---------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Any editable view     | `Space`                      | `grab` or `grabbing` | none             | Camera motion                                     | Pan                                                      |
| Network Select        | Empty                        | `grab`               | none             | Camera motion                                     | Pan                                                      |
| Network Select        | Service path                 | `default`            | none             | Target cue                                        | Select the Service and focus that path                   |
| Network Select        | Service terminus             | `grab`               | `extend`         | Target cue                                        | Begin extending that Service                             |
| Network extending     | Same Service path interior   | `grabbing`           | `loop`           | Routed path, shared infrastructure, endpoint hint | Close a directional loop                                 |
| Network extending     | Same-mode Service interior   | `grabbing`           | `connect`        | Routed path, shared infrastructure, endpoint hint | Connect paths while preserving both Services             |
| Network extending     | Same-mode Service terminus   | `grabbing`           | `connect`        | Routed path, shared infrastructure, endpoint hint | Open **Connect paths** / **Join into a through-service** |
| Network extending     | Different-mode Service       | `not-allowed`        | none             | None                                              | Refuse the connection without changing either Service    |
| Network Line          | Compatible infrastructure    | `crosshair`          | `connect`        | Endpoint cue; routed path after anchoring         | Route the Service over that infrastructure               |
| Network Line          | Empty                        | `crosshair`          | `new`            | New Service-and-Way stroke                        | Draw a Line, its Service, and physical infrastructure    |
| Network Line          | `Alt`/`Option`               | `crosshair`          | `separate`       | Deliberately separate Way stroke                  | Draw separate infrastructure instead of sharing          |
| Network armed return  | Armed Service terminus       | `crosshair`          | `one-way-return` | One-way return path and endpoint hint             | Draw the inbound side                                    |
| Network               | Right-click Service path     | `default`            | none             | Action anchor at the resolved path position       | Open **Divide Service here** and **End Service here**    |
| Network               | Right-click terminus         | `default`            | none             | Action anchor at the resolved Service end         | Open **Convert end to two one-way paths**                |
| Infrastructure Select | Control point                | `grab`               | `move`           | Target cue and moved Way geometry                 | Move the control point                                   |
| Infrastructure Select | Control point + `Shift`      | `grab`               | `constrain`      | Constrained Way geometry                          | Move the point with the active geometric constraint      |
| Infrastructure Select | Control point + `Alt`/Option | `grab`               | `erase`          | Target cue                                        | Erase the point, or sweep across points while dragging   |
| Infrastructure Select | Interior point + `Ctrl`/`⌘`  | `default`            | `split`          | Target cue                                        | Split the Way at that control point                      |
| Infrastructure Select | Endpoint + `Ctrl`/`⌘`        | `grab`               | `extend`         | Way extension                                     | Extend the physical Way                                  |
| Infrastructure        | Right-click Way              | `default`            | none             | Action anchor at the resolved Way point           | Open **Split path here**                                 |
| Read-only or Diagram  | Editable target              | `not-allowed`        | none             | None                                              | Refuse the edit                                          |

Dropping an extension on an invalid target, dismissing the connection chooser,
or pressing `Escape` changes no saved network data. A successful gesture is
one undo checkpoint. Service-path edits do not move or split Ways,
Junctions, or Stations unless the user explicitly chooses an infrastructure operation.

## Touch equivalents

Touch reaches the operations above through a different grammar, not a reduced
one. Each row of this table names the mouse gesture it stands in for; the
resolved operation, badge, and undo behaviour are identical, because both
grammars dispatch through the same intent resolution.

| Touch gesture     | Stands in for              | Result                                                                      |
| ----------------- | -------------------------- | --------------------------------------------------------------------------- |
| One-finger drag   | Left-drag                  | The active tool's operation: draw, move, extend, or marquee                 |
| Two-finger drag   | Right-drag or `Space`-drag | Pan                                                                         |
| Pinch             | Scroll                     | Zoom. Rotation and pitch stay disabled                                      |
| Long press, 500ms | Right-click                | Open the action anchor and its menu, finish a draw, or add a one-way return |
| Double tap        | Double-click               | Finish the current line                                                     |
| Tap               | Click                      | Select, deselect, or place the next point                                   |

A press that has not yet moved past the drag threshold has committed to
nothing. Lifting it is a tap, moving it starts the tool's gesture, and holding
it opens the actions menu.

Pointer tolerances scale with the pointer. A coarse pointer hit-tests within
24 CSS pixels rather than 9, because a fingertip contact patch measures 9-11mm
and cannot be placed inside a 9-pixel radius. The full table is in
`apps/web/src/editor/input-tuning.ts`.

## Modifier channels

A press can be qualified by four modal channels. They are named for what they
qualify rather than for the key that sets them, because a keyboard is only one
of two ways to set them.

| Channel     | Key            | Qualifies                                                       |
| ----------- | -------------- | --------------------------------------------------------------- |
| `constrain` | `Shift`        | Angle-snapping and constrained moves                            |
| `alternate` | `Alt`/`Option` | Erase; deliberately separate infrastructure in the Line tool    |
| `secondary` | `Ctrl`/`⌘`     | Split at an interior point, extend at an endpoint               |
| `pan`       | `Space`        | Camera pan. Touch uses two fingers instead                      |
| `actions`   | Right button   | The action anchor and its menu. Touch uses a long press instead |

A held key and a Select variant (below) produce the same input, so the resolved
operation, badge, and cursor are identical either way.

`constrain` is the only channel that may change during a gesture, and it alters
only geometry, never the operation.

## Select variants

Erasing and splitting are things the Select tool does, so they are variants of
it: chosen from its chevron in the dock, shown on its button, and exclusive of
each other. This is how both operations are reached without a keyboard, since
`Alt` and `Ctrl` cannot be held on a touchscreen.

| Variant  | Sets        | A press then                                         |
| -------- | ----------- | ---------------------------------------------------- |
| `select` | nothing     | Selects, moves, or extends, per the table above      |
| `erase`  | `alternate` | Removes the point, station, or facility pressed      |
| `split`  | `secondary` | Splits a Way at an interior point, extends at an end |

A held `Alt` or `Ctrl` reaches the same operation without changing the variant,
so a mouse is unaffected.

`Shift` has no variant. It constrains a drag already under way rather than
deciding what a press does, and a finger can draw the angle directly.
