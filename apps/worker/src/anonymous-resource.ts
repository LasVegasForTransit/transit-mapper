import { ANONYMOUS_SHARE_TTL_MS } from '@transitmapper/core/share/ownership';

// A public resource that remains in active use should not expire. The one-day
// threshold prevents every read from becoming a D1 write while keeping an
// active resource at least six days from expiry.
const EXPIRY_TOUCH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function anonymousExpiry(now: number): number {
  return now + ANONYMOUS_SHARE_TTL_MS;
}

export function shouldTouchAnonymousExpiry(expiresAt: number | null, now: number): boolean {
  if (expiresAt === null) return false;
  return anonymousExpiry(now) - expiresAt >= EXPIRY_TOUCH_THRESHOLD_MS;
}

// The database stores only this digest. The raw token stays with the browser
// that created the resource and proves ownership on later writes.
export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomEditToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
