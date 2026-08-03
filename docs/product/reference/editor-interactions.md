# Editor interactions

This is the normative vocabulary and pointer-intent reference for the editor.
User-facing copy uses the terms below. Code and model documentation may name
the TypeScript representation when that distinction helps a maintainer.

## Vocabulary reference

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

Use **junction** in the interface and user guides. Use `Node` only when
describing the saved representation or a code identifier. A visible crossing
is not a junction until the corridors share topology.

## Pointer-intent reference

The native cursor and its badge are one contract with the operation dispatched
on pointer-down. Modifier changes recompute an idle pointer's intent without
requiring the pointer to move. Once pointer-down starts a gesture, its primary
operation is locked; only `Shift` may add or remove a geometric constraint.

`None` in the Preview column means the interaction does not draw a live
geometry preview. A **target cue** marks the object the operation will use. An
**action anchor** is the persistent right-click marker defined above.

| Context               | Target or modifier           | Cursor               | Badge            | Preview                                      | Result                                                   |
| --------------------- | ---------------------------- | -------------------- | ---------------- | -------------------------------------------- | -------------------------------------------------------- |
| Any editable view     | `Space`                      | `grab` or `grabbing` | none             | Camera motion                                | Pan                                                      |
| Network Select        | Empty                        | `grab`               | none             | Camera motion                                | Pan                                                      |
| Network Select        | Line body                    | `default`            | none             | Target cue                                   | Select the line and focus the nearest branch occurrence  |
| Network Select        | Service terminus             | `grab`               | `extend`         | Target cue                                   | Begin extending that branch                              |
| Network extending     | Same branch interior         | `grabbing`           | `loop`           | Routed path, shared corridor, endpoint hint  | Close a directional loop                                 |
| Network extending     | Same-mode line interior      | `grabbing`           | `connect`        | Routed path, shared corridor, endpoint hint  | Connect paths while preserving both lines                |
| Network extending     | Same-mode line terminus      | `grabbing`           | `connect`        | Routed path, shared corridor, endpoint hint  | Open **Connect paths** / **Join into a through-service** |
| Network extending     | Different-mode line          | `not-allowed`        | none             | None                                         | Refuse the connection without changing either line       |
| Network Line          | Compatible corridor          | `crosshair`          | `connect`        | Endpoint cue; routed path after anchoring    | Route the service over that corridor                     |
| Network Line          | Empty                        | `crosshair`          | `new`            | New service-and-corridor stroke              | Draw a service and its physical corridor                 |
| Network Line          | `Alt`/`Option`               | `crosshair`          | `separate`       | Deliberately separate corridor stroke        | Draw a separate corridor instead of sharing              |
| Network armed return  | Armed branch terminus        | `crosshair`          | `one-way-return` | One-way return path and endpoint hint        | Draw the inbound side                                    |
| Network               | Right-click line             | `default`            | none             | Action anchor at the resolved line position  | Open **Divide line here** and **End line here**          |
| Network               | Right-click terminus         | `default`            | none             | Action anchor at the resolved branch end     | Open **Convert end to two one-way paths**                |
| Infrastructure Select | Control point                | `grab`               | `move`           | Target cue and moved corridor geometry       | Move the control point                                   |
| Infrastructure Select | Control point + `Shift`      | `grab`               | `constrain`      | Constrained corridor geometry                | Move the point with the active geometric constraint      |
| Infrastructure Select | Control point + `Alt`/Option | `grab`               | `erase`          | Target cue                                   | Erase the point, or sweep across points while dragging   |
| Infrastructure Select | Interior point + `Ctrl`/`⌘`  | `default`            | `split`          | Target cue                                   | Split the corridor at that control point                 |
| Infrastructure Select | Endpoint + `Ctrl`/`⌘`        | `grab`               | `extend`         | Corridor extension                           | Extend the physical corridor                             |
| Infrastructure        | Right-click corridor         | `default`            | none             | Action anchor at the resolved corridor point | Open **Split corridor here**                             |
| Read-only or Diagram  | Editable target              | `not-allowed`        | none             | None                                         | Refuse the edit                                          |

Dropping an extension on an invalid target, dismissing the connection chooser,
or pressing `Escape` changes no saved network data. A successful gesture is
one undo checkpoint. Service-path edits do not move or split corridors,
junctions, or stations unless the user explicitly chooses a corridor operation.

## Touch equivalents

Touch reaches the operations above through a different grammar, not a reduced
one. Each row of this table names the mouse gesture it stands in for; the
resolved operation, badge, and undo behaviour are identical, because both
grammars dispatch through the same intent resolution.

| Touch gesture     | Stands in for              | Result                                                                  |
| ----------------- | -------------------------- | ----------------------------------------------------------------------- |
| One-finger drag   | Left-drag                  | The active tool's operation: draw, move, extend, or marquee             |
| Two-finger drag   | Right-drag or `Space`-drag | Pan                                                                     |
| Pinch             | Scroll                     | Zoom. Rotation and pitch stay disabled                                  |
| Long press, 500ms | Right-click                | Open the action anchor and its menu, finish a draw, or branch a one-way |
| Double tap        | Double-click               | Finish the current line                                                 |
| Tap               | Click                      | Select, deselect, or place the next point                               |

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
of two ways to set them: each can also be latched from the inspector, which is
how a touchscreen reaches operations that would otherwise need a key held.

| Channel     | Key            | Latchable | Qualifies                                                       |
| ----------- | -------------- | --------- | --------------------------------------------------------------- |
| `constrain` | `Shift`        | Yes       | Angle-snapping and constrained moves                            |
| `alternate` | `Alt`/`Option` | Yes       | Erase; separate-corridor drawing in the Line tool               |
| `secondary` | `Ctrl`/`⌘`     | Yes       | Split at an interior point, extend at an endpoint               |
| `pan`       | `Space`        | No        | Camera pan. Touch uses two fingers instead                      |
| `actions`   | Right button   | No        | The action anchor and its menu. Touch uses a long press instead |

A held key and a latched channel produce the same input, so the resolved
operation, badge, and cursor are identical either way. `pan` and `actions` do
not latch: both already have a touch gesture, and a latched action-menu mode
would be a trap rather than a convenience.

`constrain` is the only channel that may change during a gesture, and it alters
only geometry, never the operation.
