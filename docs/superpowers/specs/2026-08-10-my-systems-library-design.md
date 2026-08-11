# My systems library

## Status

Approved 2026-08-10. The chosen visual direction is a responsive library with
both card and list views. Cards are the default for someone who has not chosen
a view; afterwards the browser remembers the last choice.

## Problem

`SystemsDialog` already contains the storage operation required to switch
systems, but exposes it as a small unlabeled dot at the start of each row. The
system name is an editable field and the conspicuous controls at the end of the
row are Duplicate and Delete. The result is a management dialog that appears to
offer no way to perform its primary job.

The dialog's description promises that a person can switch systems, and an app
banner directs people to open saved work from My systems. The control's visual
hierarchy breaks both promises even though the underlying operation exists.

## Goals

- Make opening and switching systems the unmistakable primary action.
- Let a person recognize a saved system from its network, not only its name.
- Keep a compact list for larger libraries.
- Preserve pending edits before switching documents.
- Keep rename, duplicate, sharing, and delete available without letting them
  compete with Open.
- Keep the library usable while previews load or fail.
- Make every state keyboard accessible and usable on compact touch layouts.

## Non-goals

- Storing generated thumbnails or changing the library index schema. A preview
  is derived from the saved system and should not become a second source of
  truth.
- Adding search, sorting, folders, cloud sync, or cross-device storage.
- Rendering interactive MapLibre instances inside the dialog. A library of
  live maps would add network, memory, and lifecycle cost to a recognition aid.
- Redesigning the File menu or changing how systems are serialized.

## Interaction design

The dialog opens in card view for a browser with no saved preference. A
two-option segmented control labeled List and Cards changes the presentation
and stores that preference locally. If preference storage is unavailable, the
control still works for the current mount and the failure is silent because no
work is at risk.

Both views share one semantic list and the same actions:

- A non-current system has a text button labeled `Open`. In card view, its map
  preview is an additional large Open target. No action relies on discovering
  an icon or hover state.
- The active system is visually selected and labeled `Current`; it has no
  enabled Open action.
- The system name remains editable in place. Pressing Enter commits by blurring,
  as it does today.
- Share status, Duplicate, and Delete stay secondary. They use labeled icon
  controls with adequate touch targets; delete keeps its inline confirmation.
- New system stays in the dialog toolbar so it remains distinct from actions on
  an existing system.

Card view uses a two-column grid where space permits and one column on compact
screens. Each card contains a fixed-aspect network portrait, editable name,
last-edited text or Current status, an explicit Open action, and the secondary
action group. List view removes the portrait and compresses the same information
into rows without changing wording or action order.

The dialog grows beyond its current 440-pixel width on desktop so the grid is
not cramped. It retains the existing viewport maximum and becomes a single
column before a card would become too narrow. Scrolling belongs to the library
content, leaving the dialog heading and toolbar stable.

## Switching behavior

Opening a system is a guarded asynchronous operation:

1. Ignore the active system and any second request while another switch is in
   progress.
2. Flush the current system's pending autosave before replacing editor state.
3. If that flush reports `full` or `unavailable`, keep the current system on
   screen and the dialog open. The existing save-status banner explains the
   failure, and Delete remains available as the way to free space.
4. Load the selected saved system.
5. On success, set its active ID, install it as the editable system, and close
   the dialog.

The selected card or row reports that it is opening and disables repeated
activation. Other destructive or document-changing controls are disabled until
the operation settles. This prevents two loads from racing and prevents an
action from targeting a document whose switch is already underway.

The existing save-outcome mechanism remains the authority on whether a flush
could be persisted. The persistence coordinator's flush result becomes
observable to this caller as `SaveOutcome` while continuing to report through
the app's save-status path, so switching does not invent a second error
vocabulary. Refusing to replace an undurable current document is the same
data-safety boundary already described in the product design principles.

## Preview architecture

`LibraryEntry` intentionally contains only `id`, `name`, and `updatedAt`, so
card previews are loaded separately after the index has rendered. The dialog
must not wait for every saved document before showing its controls.

For each entry visible to the dialog, the preview path loads the saved system
through `loadSystemEntry` and passes it to the existing pure `previewSvg`
renderer in `packages/core/src/render/preview.ts`. That renderer already frames
the whole network without a basemap and supplies an empty-system composition.
The card presents the returned markup as a non-interactive image with the
system name as alternative text.

Preview results live only in component state for the dialog mount. They are not
written into IndexedDB or localStorage. Refreshing after rename, duplication,
or deletion reconciles preview state to the returned entry IDs and generates
only missing portraits.

Loading is bounded so a large library does not parse and render every document
at once. A three-task pool processes entries incrementally. Each card occupies
its final image area immediately, preventing layout shift.

## Failure states

The library index can be unavailable, a listed document can disappear, and a
stored document can be corrupt. None makes the whole dialog blank.

- Index unavailable keeps the existing explanation and Try again action.
- Preview pending shows a neutral skeleton in the final image bounds.
- Preview missing or corrupt shows a labeled `Preview unavailable` surface.
  The card or row remains present so delete is still reachable.
- Opening a corrupt system calls the existing `onCorrupt` notice path and keeps
  the dialog open.
- Opening a missing system refreshes the index and keeps the dialog open.
- Opening while storage is unavailable marks the library unavailable and
  exposes Try again.

Errors from preview generation are isolated to that preview. A picture is an
aid to recognition, never a prerequisite for opening saved work.

## Accessibility

The List/Cards control uses pressed or selected semantics and has a visible
label for each choice. Open is always visible as text. Preview activation is a
real button whose accessible name includes the system name. Current is conveyed
in text and selection semantics, not color alone.

All interactive targets meet the existing touch-target rules. Focus order is
heading controls, then systems in reading order, with each system's Open before
its secondary actions. Loading status is exposed without moving focus. Reduced
motion users receive no new animation beyond existing modal behavior.

## Testing

An isolated `SystemsDialog` Vitest file under `apps/web/tests/ui/` will exercise
the component against mocked browser-library boundaries and the real editor
selector contract. Cases state the user-visible rule they enforce:

- opening a saved system flushes the current save before replacing it;
- a failed current-system flush prevents the switch without hiding Delete;
- opening a saved system sets the active ID and closes the dialog;
- the current system is labeled and cannot be reopened;
- a second open cannot race the first;
- list and card views expose the same saved systems and Open actions;
- the chosen view survives a dialog remount when preference storage works;
- a failed preference write does not break the toggle;
- a preview failure leaves Open and Delete reachable;
- corrupt, missing, and unavailable open results keep the dialog recoverable;
- duplication and deletion continue to refresh the library.

Pure helpers introduced for preference parsing, preview scheduling, or view
state receive focused tests rather than being covered only through DOM shape.
The final repository gate is `pnpm check`.

## Documentation impact

This change does not add a subsystem, schema, request path, or communication
boundary, so Project structure does not need a new entry. The design remains in
this document, and code comments will record only the non-obvious constraints:
save-before-switch ordering, bounded preview work, and why preview failure never
disables Open.
