# Sidebar Chrome Correction

## Problem

The desktop sidebar renders its panel control in a second row labelled
“Network outline,” “Infrastructure outline,” or “Diagram outline.” The label
only repeats the active view, while the detached control reads as if it acts
on that label instead of the sidebar. On compact screens, the active-view
control also competes with the file menu, editable system name, and document
actions in one top row. Long view names therefore make the system name
unreadable.

## Design

Desktop uses one sidebar navigation row: file menu, system name, then the
show/hide-sidebar control. The redundant outline heading is removed. The
sidebar remains labelled for assistive technology according to the active
view, and its body begins with Search.

Compact layouts reserve the anchored top bar for document identity and
document actions. The active-view selector moves into the persistent
workbench rail beside the other canvas-state controls. It stays mounted once,
keeps the same menu and accessible label, and remains available while the
workbench content is closed.

## Verification

Workbench rendering tests enforce both placements and reject the obsolete
desktop heading. Existing interaction and responsive tests continue to cover
the panel toggle, compact workbench, and single-mount boundary. A browser
check at desktop and compact widths confirms readable system-name space and
aligned controls.
