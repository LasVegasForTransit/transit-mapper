export type InstallBrowser = 'chromium' | 'safari' | 'firefox' | 'other';

export interface InstallPromptEvent {
  prompt: () => Promise<void>;
}

export interface InstallStorage {
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
    return 'Use Firefox’s Install option from the address bar or browser menu.';
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
    isDesktop: () => {
      const narrow = window.matchMedia?.('(max-width: 767px)').matches === true;
      const mobileAgent = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
      return !narrow && !mobileAgent;
    },
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

  const notify = () => listeners.forEach((listener) => listener());
  const writePreferences = () => {
    try {
      environment.storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Private or quota-limited storage may reject a preference write. The
      // current session still behaves correctly; only its snooze may not last.
    }
  };
  const permanentlySuppressed = () => preferences.installed || environment.isStandalone();

  const state = (): InstallState => {
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
