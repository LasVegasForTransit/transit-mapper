# Keyboard shortcuts

Press `?` in the editor for this list in a dialog. Everything the keyboard
does is also reachable by pointer, whether that pointer is a mouse or a
finger; the touch equivalents are in
[Editor interactions](editor-interactions.md#touch-equivalents). Shortcuts
don't fire while you're typing in a text field.

The single source of truth is `KEY_BINDINGS` in
[`src/editor/keymap.ts`](../../../apps/web/src/editor/keymap.ts); this page mirrors it.

## Tools

| Key | Action                           |
| --- | -------------------------------- |
| `V` | Select & edit                    |
| `L` | Draw way / line (last kind used) |
| `R` | Draw road                        |
| `T` | Draw track                       |
| `P` | Draw path                        |
| `S` | Add Stop / draw Station          |
| `F` | Place facility                   |

## Camera

| Key                  | Action             |
| -------------------- | ------------------ |
| Arrow keys           | Pan                |
| `Z`, `+`, `PageUp`   | Zoom in            |
| `X`, `-`, `PageDown` | Zoom out           |
| Hold `Space` + drag  | Pan with the mouse |

## Editing

| Key                                          | Action                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Esc`                                        | Back out one level: cancel the in-progress draw or armed flow, then drop the tool, then clear the selection |
| `Enter`                                      | Commit the Line, Service path, or Way being drawn                                                           |
| `Delete` / `Backspace`                       | Delete the selection                                                                                        |
| `Ctrl`/`⌘` + `Z`                             | Undo                                                                                                        |
| `Ctrl`/`⌘` + `Shift` + `Z`, `Ctrl`/`⌘` + `Y` | Redo                                                                                                        |

Undo/redo are the only browser-style keyboard combos the app claims. `Ctrl`/`⌘`
also acts as a pointer modifier over Way control points, as described
below; other keyboard combos pass through to the browser.

## Pointer modifiers

These change the cursor badge and the operation before pointer-down. They also
update while the pointer is stationary. Pointer-down locks the primary
operation for that gesture; after a drag starts, only `Shift` may change its
geometric constraint.

| Modifier              | Pointer meaning                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Hold `Space`          | Pan the camera in any view                                                                          |
| Hold `Shift`          | Constrain a control-point move; during a drag, add or remove only the geometric constraint          |
| Hold `Alt` / `Option` | Erase Infrastructure control points, or deliberately draw a separate Way with the Network Line tool |
| Hold `Ctrl` / `⌘`     | Split at an interior Way control point, or extend from a Way endpoint                               |

The full cursor, badge, preview, and result matrix is in
[Editor interactions](editor-interactions.md#pointer-intent-reference).

## Lanes

These act on the way being drawn right now, or else the selected way,
whichever the cross-section editor is showing.

| Key       | Action                                                                                     |
| --------- | ------------------------------------------------------------------------------------------ |
| `[` / `]` | Remove / add a lane                                                                        |
| `D`       | Flip direction (reverse the whole cross-section)                                           |
| `O`       | Toggle one-way ⇄ two-way; with only the drawing tool armed, arms one-way for the next draw |
| `1`–`9`   | Apply that numbered cross-section preset (or arm it as the drawing default)                |

## Simulation

See [The simulation](../explanation/simulation.md).

| Key       | Action                                          |
| --------- | ----------------------------------------------- |
| `K`       | Run / pause the simulated clock                 |
| `,` / `.` | One step slower / faster along the speed ladder |

## Other

| Key | Action                            |
| --- | --------------------------------- |
| `C` | Capture a PNG of the whole system |
| `\` | Show / hide the UI                |
| `?` | Show the shortcuts dialog         |
