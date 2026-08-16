import { useMediaQuery } from '../device/media-query';
import type { ColorScheme } from './color-scheme';

export type { ColorScheme } from './color-scheme';

export function useSystemColorScheme(): ColorScheme {
  return useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
}
