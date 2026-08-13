import type { UnitSystem } from '@transitmapper/core/model/units';
import { useSyncExternalStore } from 'react';

// Preference keys
const STORAGE_PREFIX = 'transitmapper:user-prefs:';
const UNIT_SYSTEM_KEY = `${STORAGE_PREFIX}unit-system`;

/** Unit convention inferred only when the browser has no saved preference. */
export function unitSystemForLocale(locale: string): UnitSystem {
  const normalized = locale.toLowerCase();
  const language = normalized.split('-')[0];
  return normalized.startsWith('en-us') || normalized.startsWith('en-lr') || language === 'my'
    ? 'imperial'
    : 'metric';
}

// Default unit system based on browser locale
function getDefaultUnitSystem(): UnitSystem {
  if (typeof navigator === 'undefined') return 'metric';
  return unitSystemForLocale(navigator.language);
}

type Listener = () => void;
const listeners = new Set<Listener>();

interface UserPreferences {
  unitSystem: UnitSystem;
}

// Cached snapshot to prevent unnecessary re-renders from Object.is comparisons
let cachedSnapshot: UserPreferences | null = null;
let memoryUnitSystem: UnitSystem | null = null;

function getPreferences(): UserPreferences {
  if (typeof window === 'undefined') {
    return { unitSystem: 'metric' };
  }
  if (memoryUnitSystem) return { unitSystem: memoryUnitSystem };
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(UNIT_SYSTEM_KEY);
  } catch {
    // A preference is cosmetic, so unavailable browser storage must not make
    // the settings surface or the rest of the editor unusable.
  }
  const unitSystem = stored === 'metric' || stored === 'imperial' ? stored : getDefaultUnitSystem();
  return { unitSystem };
}

function getCachedSnapshot(): UserPreferences {
  const current = getPreferences();
  // Only replace cached snapshot if the underlying value changed
  if (!cachedSnapshot || cachedSnapshot.unitSystem !== current.unitSystem) {
    cachedSnapshot = current;
  }
  return cachedSnapshot;
}

function setPreferences(prefs: Partial<UserPreferences>): void {
  if (prefs.unitSystem !== undefined) {
    memoryUnitSystem = prefs.unitSystem;
    try {
      localStorage.setItem(UNIT_SYSTEM_KEY, prefs.unitSystem);
    } catch {
      // Keep the selection for this tab even when persistence is unavailable.
    }
    // Invalidate cache so next getCachedSnapshot call creates a fresh object
    cachedSnapshot = null;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useUserPreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getCachedSnapshot, getCachedSnapshot);
}

export function useUnitPreference(): UnitSystem {
  return useUserPreferences().unitSystem;
}

export function setUnitPreference(system: UnitSystem): void {
  setPreferences({ unitSystem: system });
}
