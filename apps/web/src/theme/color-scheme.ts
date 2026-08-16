import { mediaQuery } from '../device/media-query-store';

export type ColorScheme = 'light' | 'dark';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Vanilla color-scheme reads live in their own module so an embed can follow
 * its host's theme without importing the React hook used by the editor.
 */
export function getSystemColorScheme(): ColorScheme {
  return mediaQuery(DARK_SCHEME_QUERY).snapshot() ? 'dark' : 'light';
}

export function subscribeSystemColorScheme(listener: () => void): () => void {
  return mediaQuery(DARK_SCHEME_QUERY).subscribe(listener);
}
