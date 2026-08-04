import { mediaQuery, useMediaQuery } from '../device/media-query';

export type ColorScheme = 'light' | 'dark';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function getSystemColorScheme(): ColorScheme {
  return mediaQuery(DARK_SCHEME_QUERY).snapshot() ? 'dark' : 'light';
}

export function subscribeSystemColorScheme(listener: () => void): () => void {
  return mediaQuery(DARK_SCHEME_QUERY).subscribe(listener);
}

export function useSystemColorScheme(): ColorScheme {
  return useMediaQuery(DARK_SCHEME_QUERY) ? 'dark' : 'light';
}
