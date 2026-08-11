export type SystemsView = 'list' | 'cards';

export interface SystemsViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SYSTEMS_VIEW_KEY = 'transitmapper:systemsView';

function browserStorage(): SystemsViewStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function readSystemsView(
  storage: SystemsViewStorage | null = browserStorage(),
): SystemsView {
  try {
    const stored = storage?.getItem(SYSTEMS_VIEW_KEY);
    return stored === 'list' || stored === 'cards' ? stored : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeSystemsView(
  view: SystemsView,
  storage: SystemsViewStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(SYSTEMS_VIEW_KEY, view);
  } catch {
    // This is a display preference, not work. Keep the in-memory choice and
    // let a storage-restricted browser forget it instead of surfacing noise.
  }
}
