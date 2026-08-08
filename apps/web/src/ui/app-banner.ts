import type { SaveOutcome } from '../storage/localStore';

/**
 * One place that decides which single message the app is showing and what it
 * says.
 *
 * This used to be a seven-deep ternary inside `App`, reading five pieces of
 * local state — two of which were booleans encoding the same lifecycle, and
 * one of which stored a finished English sentence. Nothing about that could be
 * tested without mounting the editor, so the priority order between "your work
 * isn't saving" and "a new version is available" was only ever verified by
 * someone looking at it.
 *
 * Everything here is a pure function of the inputs below, so `pnpm verify`
 * covers the whole matrix with no DOM.
 */

/** Why bootstrap did not produce a document. The *lifecycle* — whether a
 *  document has arrived at all — belongs to the editor store's
 *  `documentStatus`; this is only the reason, which the store cannot know.
 *  Keeping them apart means the two can never contradict each other. */
export type BootstrapOutcome =
  | { kind: 'ok' }
  | { kind: 'storage-unavailable' }
  // Carries no message. The exception text for a fetch with no route is some
  // variation on "Failed to fetch", which told the reader nothing and was the
  // whole of what this banner used to say after a colon.
  | { kind: 'share-failed' };

/**
 * Something that already happened and is worth reading once.
 *
 * Stored as a cause rather than as the sentence describing it. The sentence is
 * mapped below at render time, which is what lets one cause read differently
 * depending on other live state — see `basemap-unavailable`, whose honest
 * explanation depends on whether the browser has a network right now, not on
 * whether it had one at the instant the tiles failed.
 */
export type NoticeCause =
  | 'corrupt-system'
  | 'corrupt-open'
  | 'dialog-failed'
  | 'basemap-unavailable'
  | 'saved-system-arrived';

export type AppBannerActionKind =
  'retry-bootstrap' | 'start-new-system' | 'reload' | 'dismiss-offline-ready' | 'dismiss-notice';

interface AppBannerAction {
  kind: AppBannerActionKind;
  /** Button text, or the accessible name when the action renders as an icon. */
  label: string;
}

export interface AppBannerDescriptor {
  /** `danger` is the default red treatment; `update` borrows the app's accent
   *  for the two messages that report good news rather than a problem. */
  tone: 'danger' | 'update';
  /** `plain` is a text block. `inline` centers a short message beside its
   *  control. `wrapped` aligns to the top instead, because a message long
   *  enough to wrap looks visibly off centered against its dismiss button. */
  layout: 'plain' | 'inline' | 'wrapped';
  message: string;
  actions: AppBannerAction[];
  /** The X button, separate from `actions` because it renders as an icon and
   *  because whether a banner may be dismissed is a claim about the message:
   *  a condition that is still true must not be clearable. */
  dismiss: AppBannerAction | null;
  /** `alert` for something still going wrong, `status` for everything else. */
  live: 'alert' | 'status';
}

export interface AppBannerInputs {
  /** Anything but `saved` means the editor is lying about being safe to close. */
  save: SaveOutcome;
  bootstrap: BootstrapOutcome;
  /** A newer service worker is waiting to take over. */
  updateWaiting: boolean;
  /** The precache finished — the editor now opens without a network. This is
   *  Workbox's signal about caching, not a claim about connectivity. */
  offlineReady: boolean;
  notice: NoticeCause | null;
  /** The saved document is taking long enough that the silence needs
   *  explaining. Deliberately not "is loading": the editor is on screen and
   *  usable the whole time, and announcing a wait nobody noticed would invent
   *  one. Only a wait somebody has started to feel is worth a sentence. */
  documentSlowToLoad: boolean;
  /** Whether the browser currently believes it has a network. Used only to
   *  explain a failure that already happened — see network/useOnlineStatus for
   *  why the `true` direction means nothing and is never acted on. */
  online: boolean;
}

/** Offered wherever startup could not produce the document it went looking
 *  for. Retrying is the first answer, but a retry that keeps failing leaves
 *  someone with a working editor they are not allowed to type into, so there
 *  has to be a way forward that does not depend on the thing that is broken. */
const bootstrapFailureActions: AppBannerAction[] = [
  { kind: 'retry-bootstrap', label: 'Try again' },
  { kind: 'start-new-system', label: 'Start a new system' },
];

function saveMessage(outcome: SaveOutcome): string | null {
  if (outcome === 'full')
    return 'Your browser’s storage is full, so your work is no longer being saved. Export this system, or delete one you don’t need, to make room.';
  if (outcome === 'unavailable')
    return 'This browser isn’t saving your work — storage is unavailable here, which private browsing windows often do. Export before closing the tab.';
  return null;
}

function noticeMessage(cause: NoticeCause, online: boolean): string {
  switch (cause) {
    // The common case by far is a chunk whose filename changed under a tab
    // that was left open, so "reload" is the actual fix rather than a shrug.
    case 'dialog-failed':
      return 'That dialog couldn’t be loaded. Your system is safe — reload the page and try again.';
    // Says what still works, because most of it does: the basemap is a
    // backdrop from a third-party host, and everything the user has drawn is
    // ours. Being offline is the likeliest reason by a wide margin and the
    // only one the reader can act on, so it is named when it applies — and
    // because this is derived at render time rather than frozen when the
    // tiles failed, going offline afterwards rewords it.
    case 'basemap-unavailable':
      return online
        ? 'The background map couldn’t be loaded, so the map behind your system is blank. Your system is unaffected and still saved.'
        : 'You’re offline, so the background map is blank. Everything you’ve drawn is here and still saved — the map fills in when you reconnect.';
    // Deliberately says the damaged copy still exists. "Your work is gone" and
    // "your work is here but unreadable" call for very different reactions,
    // and only one of them is true.
    case 'corrupt-system':
      return 'The system you had open couldn’t be read, so this is a new one. The damaged copy is still saved and hasn’t been deleted.';
    // Same condition reached deliberately rather than at startup — the user
    // clicked a row and deserves to know why nothing happened.
    case 'corrupt-open':
      return 'That system couldn’t be read, so it can’t be opened. Its data is still saved and hasn’t been deleted.';
    // The user started a blank system while storage was still being read, and
    // then the read succeeded. Their blank one stays on screen, because
    // replacing what somebody is already working in is exactly the theft this
    // whole area exists to prevent — but the other one is not lost, and saying
    // where it went is the difference between a choice and a disappearance.
    case 'saved-system-arrived':
      return 'Your saved system finished loading after you started this one. Nothing was replaced — open it from My systems whenever you want it.';
  }
}

/**
 * The one message the app is showing, or null for none.
 *
 * The order below is the whole point of collecting these in one function. A
 * failing autosave outranks everything: the others describe something that
 * already happened, while that one is still happening and gets worse the
 * longer it goes unread.
 */
export function resolveAppBanner(inputs: AppBannerInputs): AppBannerDescriptor | null {
  const saving = saveMessage(inputs.save);
  if (saving)
    return {
      tone: 'danger',
      layout: 'plain',
      message: saving,
      actions: [],
      dismiss: null,
      live: 'alert',
    };

  if (inputs.bootstrap.kind === 'storage-unavailable')
    return {
      tone: 'danger',
      layout: 'inline',
      message:
        'Your saved systems are temporarily unavailable. Nothing was replaced; retry when browser storage is available again.',
      actions: bootstrapFailureActions,
      dismiss: null,
      live: 'alert',
    };

  if (inputs.bootstrap.kind === 'share-failed')
    return {
      tone: 'danger',
      layout: 'inline',
      message: inputs.online
        ? 'That shared system couldn’t be opened. The link may have expired, or the server may be unreachable right now.'
        : 'You’re offline, so that shared system couldn’t be opened. Shared links are fetched from the server every time and aren’t stored on this device.',
      actions: bootstrapFailureActions,
      dismiss: null,
      live: 'alert',
    };

  // Not dismissible — reloading is the only way to clear it, and it isn't an
  // error, so it deliberately doesn't borrow the danger tone.
  if (inputs.updateWaiting)
    return {
      tone: 'update',
      layout: 'inline',
      message: 'A new version of TransitMapper is available.',
      actions: [{ kind: 'reload', label: 'Reload' }],
      dismiss: null,
      live: 'status',
    };

  // Good news, not a problem — same neutral tone as the update above.
  // `inline`, not `wrapped`: that alignment exists for the longer, wrapping
  // messages a notice carries, and looks visibly off on this one-liner.
  if (inputs.offlineReady)
    return {
      tone: 'update',
      layout: 'inline',
      message: 'TransitMapper is now available offline.',
      actions: [],
      dismiss: { kind: 'dismiss-offline-ready', label: 'Dismiss' },
      live: 'status',
    };

  // Dismissible, unlike the ones above. Those describe a condition that is
  // still true — a share that won't load, a save that isn't happening — and
  // clearing them would be a lie. A notice describes something that already
  // happened and has been read, and it sits over a canvas whose entire
  // interaction model is clicking on it, so it must be possible to get rid of.
  if (inputs.notice)
    return {
      tone: 'danger',
      layout: 'wrapped',
      message: noticeMessage(inputs.notice, inputs.online),
      actions: [],
      dismiss: { kind: 'dismiss-notice', label: 'Dismiss' },
      live: 'status',
    };

  // Last, and only once the wait is long enough to be felt. The editor is
  // already on screen and working by this point, so this explains why the
  // canvas is empty rather than asking anyone to wait for it.
  if (inputs.documentSlowToLoad)
    return {
      tone: 'update',
      layout: 'plain',
      message: 'Still opening your saved system…',
      actions: [],
      dismiss: null,
      live: 'status',
    };

  return null;
}
