import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { anonymousExpiry, shouldTouchAnonymousExpiry } from './anonymous-resource';
import { SHARE_ID_PATTERN } from './oembed';

/** Reading a share row and keeping its expiry alive. Both the JSON API and
 * the HTML routes go through here so the expiry and damaged-row rules only
 * exist once. */

export interface ShareRow {
  id: string;
  system: TransitSystem;
  createdAt: number;
  /** Epoch ms, or null for a share that never expires. */
  expiresAt: number | null;
}

// Look up a share by id, treating an expired-but-not-yet-swept row as if it
// doesn't exist (and deleting it on the spot) — shared by the JSON API and
// the /s/:id HTML route so the expiry rule only lives in one place.
//
// A live share also has its clock pushed forward on the way out (see
// touchExpiry): a share people are still looking at is a share still worth
// keeping. That matters now that a share can be embedded in someone else's
// blog post, where a fixed 7-days-from-creation expiry would turn the embed
// into a 404 a week after publication.
export async function getActiveShare(db: D1Database, id: string): Promise<ShareRow | null> {
  // Ids that can't have come from shortId() are someone probing. Rejecting
  // them here rather than querying keeps junk out of the Worker's response
  // cache on /s/:id/preview.png, where every distinct id would otherwise earn
  // its own entry.
  if (!SHARE_ID_PATTERN.test(id)) return null;

  const row = await db
    .prepare('SELECT id, data, created_at, expires_at FROM systems WHERE id = ?')
    .bind(id)
    .first<{ id: string; data: string; created_at: number; expires_at: number | null }>();

  if (!row) return null;

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM systems WHERE id = ?').bind(id).run();
    return null;
  }

  // A row whose JSON won't parse is treated as a share that isn't there.
  // Letting the throw escape turns one damaged row into a 500 on the share
  // page, the API read AND the oEmbed endpoint — a 404 is both truthful (we
  // cannot produce this system) and survivable for everything around it.
  let system: TransitSystem;
  try {
    system = parseSystem(JSON.parse(row.data));
  } catch {
    console.error(`Share ${id} has unparseable data`);
    return null;
  }

  return {
    id: row.id,
    system,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Slides a share's expiry forward on view. Fire-and-forget: the caller's
 * response must not wait on it, and a share that fails to be touched simply
 * expires on its original schedule.
 *
 * This is an interim answer to "shares people still use shouldn't vanish."
 * The real answer is ownership — a signed-in user's shares get expires_at =
 * NULL and never expire — which is why the schema already treats NULL as
 * "never expires" and why this deliberately skips those rows.
 */
export function touchExpiry(
  db: D1Database,
  share: Pick<ShareRow, 'id' | 'expiresAt'>,
): Promise<unknown> | null {
  const now = Date.now();
  if (!shouldTouchAnonymousExpiry(share.expiresAt, now)) return null;
  return db
    .prepare('UPDATE systems SET expires_at = ? WHERE id = ?')
    .bind(anonymousExpiry(now), share.id)
    .run()
    .catch(() => undefined);
}
