// The one place that decides a new share's owner and expiry. They are always
// written together: a share with an owner has expires_at NULL, and a share
// without one has a concrete timestamp. Splitting the decision across call
// sites is how the two drift apart.

/** Seven days. Anonymous shares only; never extended after creation. */
export const ANONYMOUS_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewShareOwnership {
  ownerId: string | null;
  /** NULL means "never expires" — the meaning migration 0002 reserved. */
  expiresAt: number | null;
}

export function newShareOwnership(userId: string | null, now: number): NewShareOwnership {
  if (userId) return { ownerId: userId, expiresAt: null };
  return { ownerId: null, expiresAt: now + ANONYMOUS_SHARE_TTL_MS };
}
