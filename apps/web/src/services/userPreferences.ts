import { UnitSystem } from '@transitmapper/core/model/units';
import { useSyncExternalStore } from 'react';

// Preference keys
const STORAGE_PREFIX = 'transitmapper:user-prefs:';
const UNIT_SYSTEM_KEY = `${STORAGE_PREFIX}unit-system`;

// Default unit system based on browser locale
function getDefaultUnitSystem(): UnitSystem {
  if (typeof navigator === 'undefined') return 'metric';
  // Imperial for US, Liberia, Myanmar; metric for everywhere else
  const locale = navigator.language;
  return locale.startsWith('en-US') || locale === 'my' || locale === 'en-LR'
    ? 'imperial'
    : 'metric';
}

type Listener = () => void;
const listeners = new Set<Listener>();

export interface UserPreferences {
  unitSystem: UnitSystem;
}

function getPreferences(): UserPreferences {
  if (typeof window === 'undefined') {
    return { unitSystem: 'metric' };
  }
  const stored = localStorage.getItem(UNIT_SYSTEM_KEY);
  const unitSystem =
    stored === 'metric' || stored === 'imperial' ? (stored as UnitSystem) : getDefaultUnitSystem();
  return { unitSystem };
}

function setPreferences(prefs: Partial<UserPreferences>): void {
  if (prefs.unitSystem !== undefined) {
    localStorage.setItem(UNIT_SYSTEM_KEY, prefs.unitSystem);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUserPreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

export function useUnitPreference(): UnitSystem {
  return useUserPreferences().unitSystem;
}

export function setUnitPreference(system: UnitSystem): void {
  setPreferences({ unitSystem: system });
}
