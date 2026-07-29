import { useSyncExternalStore } from 'react';

export type ColorScheme = 'light' | 'dark';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function systemSchemeQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_SCHEME_QUERY);
}

export function getSystemColorScheme(): ColorScheme {
  return systemSchemeQuery()?.matches === true ? 'dark' : 'light';
}

export function subscribeSystemColorScheme(listener: () => void): () => void {
  const query = systemSchemeQuery();
  if (!query) return () => {};
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function getServerColorScheme(): ColorScheme {
  return 'light';
}

export function useSystemColorScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribeSystemColorScheme,
    getSystemColorScheme,
    getServerColorScheme,
  );
}
