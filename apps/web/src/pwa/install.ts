import { compactLayoutSnapshot, hoverCapableSnapshot } from '../device/capabilities';

type InstallBrowser = 'chromium' | 'safari' | 'firefox' | 'other';

interface InstallPromptEvent {
  prompt: () => Promise<void>;
}

interface InstallStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface InstallEnvironment {
  now: () => number;
  isDesktop: () => boolean;
  isStandalone: () => boolean;
  browser: () => InstallBrowser;
  storage: InstallStorage;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export interface InstallState {
  browser: InstallBrowser;
  isDesktop: boolean;
  eligible: boolean;
  canPrompt: boolean;
  permanentlySuppressed: boolean;
  instructions: string;
}

export interface InstallController {
  state: () => InstallState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  refresh: () => void;
  setEditable: (editable: boolean) => void;
  recordUndoableEdit: () => void;
  capturePrompt: (event: InstallPromptEvent) => void;
  requestInstall: () => Promise<void>;
  dismiss: () => void;
  recordInstalled: () => void;
}

export interface InstallRegistration {
  enabled: boolean;
  permanentlySuppressed: boolean;
}

export function shouldRegisterInstallController(registration: InstallRegistration): boolean {
  return registration.enabled && !registration.permanentlySuppressed;
}

export interface InstallBannerVisibility {
  eligible: boolean;
  uiHidden: boolean;
  readOnly: boolean;
  /** Whether resolveAppBanner is already showing something. The two live in
   *  different places — the notice floats centred over the map, the invitation
   *  docks to the right edge — so nothing in CSS stops both being on screen at
   *  once, and the pairing reads as two unrelated cards competing. */
  appNoticeShowing: boolean;
}

export function shouldShowInstallBanner(visibility: InstallBannerVisibility): boolean {
  // The invitation always loses. It is a suggestion with no deadline, and
  // everything resolveAppBanner produces is a failure or an interruption the
  // person has to deal with first. It comes back on its own once the notice
  // clears, so nothing is lost by yielding.
  if (visibility.appNoticeShowing) return false;
  return visibility.eligible && !visibility.uiHidden && !visibility.readOnly;
}

interface InstallPreferences {
  dismissals: number;
  snoozedUntil: number;
  installed: boolean;
}

const PREFERENCES_KEY = 'transitmapper.install-preferences';
const ENGAGEMENT_DELAY_MS = 90_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_WEEKS_MS = 2 * WEEK_MS;

function defaultPreferences(): InstallPreferences {
  return { dismissals: 0, snoozedUntil: 0, installed: false };
}

function readPreferences(storage: InstallStorage): InstallPreferences {
  try {
    const parsed = JSON.parse(
      storage.getItem(PREFERENCES_KEY) ?? 'null',
    ) as Partial<InstallPreferences> | null;
    if (!parsed) return defaultPreferences();
    return {
      dismissals: typeof parsed.dismissals === 'number' ? parsed.dismissals : 0,
      snoozedUntil: typeof parsed.snoozedUntil === 'number' ? parsed.snoozedUntil : 0,
      installed: parsed.installed === true,
    };
  } catch {
    // A malformed preference must never stop the editor from opening.
    return defaultPreferences();
  }
}

function installInstructions(browser: InstallBrowser): string {
  if (browser === 'safari') return 'In Safari, choose File or Share, then Add to Dock.';
  if (browser === 'firefox')
    return 'Firefox does not support installing TransitMapper as a desktop app. Use Chrome, Edge, or Safari instead.';
  if (browser === 'chromium')
    return 'Use your browser’s Install option from the address bar or menu.';
  return 'Use your browser’s install or add-to-desktop option to keep TransitMapper close at hand.';
}

function browserFromUserAgent(userAgent: string): InstallBrowser {
  if (/firefox/i.test(userAgent)) return 'firefox';
  if (/safari/i.test(userAgent) && !/(chrome|chromium|crios|edg)/i.test(userAgent)) return 'safari';
  if (/(chrome|chromium|crios|edg)/i.test(userAgent)) return 'chromium';
  return 'other';
}

export function createBrowserInstallEnvironment(): InstallEnvironment {
  return {
    now: () => Date.now(),
    // "Desktop" here means a device where installing to a desktop is a
    // meaningful offer: room for the docked layout, and a pointer that can
    // hover. Asked as two media queries rather than a user-agent test — the
    // regex this replaced (`/android|iphone|ipad|ipod|mobile/`) called an iPad
    // a phone and a Mac an iPad, because iPadOS reports itself as a Mac.
    isDesktop: () => !compactLayoutSnapshot() && hoverCapableSnapshot(),
    isStandalone: () =>
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    browser: () => browserFromUserAgent(navigator.userAgent),
    storage: window.localStorage,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

/**
 * Holds install prompting entirely inside the editor browser entry. Browsers
 * require `prompt()` to follow a user gesture, so this controller stores the
 * deferred event but exposes it only through requestInstall().
 */
export function createInstallController(environment: InstallEnvironment): InstallController {
  const openedAt = environment.now();
  let preferences = readPreferences(environment.storage);
  let editable = true;
  let edited = false;
  let promptEvent: InstallPromptEvent | null = null;
  const listeners = new Set<() => void>();

  const writePreferences = () => {
    try {
      environment.storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Private or quota-limited storage may reject a preference write. The
      // current session still behaves correctly; only its snooze may not last.
    }
  };
  const permanentlySuppressed = () => preferences.installed || environment.isStandalone();

  const buildState = (): InstallState => {
    const browser = environment.browser();
    const isDesktop = environment.isDesktop();
    const eligible =
      isDesktop &&
      editable &&
      edited &&
      environment.now() - openedAt >= ENGAGEMENT_DELAY_MS &&
      environment.now() >= preferences.snoozedUntil &&
      !permanentlySuppressed();
    return {
      browser,
      isDesktop,
      eligible,
      canPrompt: promptEvent !== null && browser === 'chromium' && !permanentlySuppressed(),
      permanentlySuppressed: permanentlySuppressed(),
      instructions: installInstructions(browser),
    };
  };
  // useSyncExternalStore compares snapshots by reference. Keep one immutable
  // object between notifications instead of allocating during every read.
  let snapshot = buildState();
  const state = (): InstallState => snapshot;
  const notify = () => {
    snapshot = buildState();
    listeners.forEach((listener) => listener());
  };

  const onBeforeInstallPrompt: EventListener = (event) => {
    event.preventDefault();
    promptEvent = event as unknown as InstallPromptEvent;
    notify();
  };
  const onAppInstalled: EventListener = () => {
    preferences = { ...preferences, installed: true };
    writePreferences();
    promptEvent = null;
    notify();
  };

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      environment.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      environment.addEventListener('appinstalled', onAppInstalled);
      return () => {
        environment.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        environment.removeEventListener('appinstalled', onAppInstalled);
      };
    },
    refresh: notify,
    setEditable(next) {
      editable = next;
      notify();
    },
    recordUndoableEdit() {
      if (edited) return;
      edited = true;
      notify();
    },
    capturePrompt(event) {
      promptEvent = event;
      notify();
    },
    async requestInstall() {
      if (!promptEvent || permanentlySuppressed()) return;
      const deferredPrompt = promptEvent;
      promptEvent = null;
      notify();
      await deferredPrompt.prompt();
    },
    dismiss() {
      const delay = preferences.dismissals === 0 ? WEEK_MS : TWO_WEEKS_MS;
      preferences = {
        ...preferences,
        dismissals: preferences.dismissals + 1,
        snoozedUntil: environment.now() + delay,
      };
      writePreferences();
      notify();
    },
    recordInstalled() {
      preferences = { ...preferences, installed: true };
      writePreferences();
      promptEvent = null;
      notify();
    },
  };
}
