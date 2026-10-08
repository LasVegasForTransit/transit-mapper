import type { WebPreset } from './web-platform.ts';

/** Older installed drivers extract standards/** only. Pure modules use verified incoming bytes. */
export async function incomingPolicy<T>(
  bundle: WebPreset,
  name: string,
  fallback: () => Promise<T>,
): Promise<T> {
  const source = bundle.files[name];
  if (source === undefined) return fallback();
  return (await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  )) as T;
}
