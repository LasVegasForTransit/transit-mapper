export type OfflineDataProtection = 'protected' | 'not-granted' | 'unavailable';

export interface PersistentStorageNavigator {
  storage?: {
    persist?: () => Promise<boolean>;
  };
}

/** Requests eviction resistance only after the person asks for it in Settings. */
export async function protectOfflineData(
  browser: PersistentStorageNavigator = navigator,
): Promise<OfflineDataProtection> {
  if (!browser.storage?.persist) return 'unavailable';
  try {
    return (await browser.storage.persist()) ? 'protected' : 'not-granted';
  } catch {
    return 'not-granted';
  }
}
