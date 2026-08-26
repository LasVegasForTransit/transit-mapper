export const SHARE_ID_PATTERN = /^[0-9a-z]{1,32}$/;

export type EmbeddableTarget =
  { kind: 'shared-system'; id: string } | { kind: 'published-view'; id: string };

/**
 * Parses only reader and embed URLs on the configured site origin. This keeps
 * the oEmbed endpoint from describing arbitrary pages under our provider name.
 */
export function embeddableTargetFromUrl(target: string, siteUrl: string): EmbeddableTarget | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.origin !== new URL(siteUrl).origin) return null;

  const match = /^\/(s|e|v|embed)\/([^/]+)\/?$/.exec(url.pathname);
  const pathKind = match?.[1];
  const id = match?.[2];
  if (!pathKind || !id || !SHARE_ID_PATTERN.test(id)) return null;
  return pathKind === 's' || pathKind === 'e'
    ? { kind: 'shared-system', id }
    : { kind: 'published-view', id };
}

export function shareIdFromUrl(target: string, siteUrl: string): string | null {
  const parsed = embeddableTargetFromUrl(target, siteUrl);
  return parsed?.kind === 'shared-system' ? parsed.id : null;
}

export function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Escapes user text before it enters the raw iframe markup in an oEmbed response. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
