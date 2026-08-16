import { describe, expect, it } from 'vitest';
import { ANONYMOUS_SHARE_TTL_MS, newShareOwnership } from '@transitmapper/core/share/ownership';
import { claimOutcome, retainedShares } from '@transitmapper/core/share/claim';

describe('claiming a share', () => {
  const now = 1_700_000_000_000;

  describe('newShareOwnership', () => {
    const owned = newShareOwnership('user_1', now);
    it('an owned share has an owner', () => {
      expect(owned.ownerId).toBe('user_1');
    });
    it('an owned share never expires', () => {
      expect(owned.expiresAt).toBeNull();
    });

    const anon = newShareOwnership(null, now);
    it('an anonymous share has no owner', () => {
      expect(anon.ownerId).toBeNull();
    });
    it('an anonymous share expires seven days out', () => {
      expect(anon.expiresAt).toBe(now + ANONYMOUS_SHARE_TTL_MS);
    });
    it('the anonymous ttl is seven days', () => {
      expect(ANONYMOUS_SHARE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('claimOutcome', () => {
    it('a 200 means the share was claimed', () => {
      expect(claimOutcome(200)).toBe('claimed');
    });
    it('a 403 is permanent — the token is wrong or spent', () => {
      expect(claimOutcome(403)).toBe('rejected');
    });
    it('a 409 is permanent — somebody already owns it', () => {
      expect(claimOutcome(409)).toBe('rejected');
    });
    it('a 404 is permanent — the share expired and is gone', () => {
      expect(claimOutcome(404)).toBe('rejected');
    });
    it('a 500 is worth retrying later', () => {
      expect(claimOutcome(500)).toBe('retry');
    });
    it('a 429 is worth retrying later', () => {
      expect(claimOutcome(429)).toBe('retry');
    });
  });

  describe('retainedShares', () => {
    const held = [
      { id: 'a', claimToken: 'ta' },
      { id: 'b', claimToken: 'tb' },
      { id: 'c', claimToken: 'tc' },
      { id: 'd', claimToken: 'td' },
    ];
    const kept = retainedShares(held, [
      { id: 'a', status: 200 },
      { id: 'b', status: 403 },
      { id: 'c', status: 500 },
    ]);

    it('a claimed share is dropped from local storage', () => {
      expect(kept.some((s) => s.id === 'a')).toBe(false);
    });
    it('a rejected share is dropped, since retrying never helps', () => {
      expect(kept.some((s) => s.id === 'b')).toBe(false);
    });
    it('a share that failed transiently is kept for next time', () => {
      expect(kept.some((s) => s.id === 'c')).toBe(true);
    });
    it('a share with no result at all is kept', () => {
      expect(kept.some((s) => s.id === 'd')).toBe(true);
    });
    it('retainedShares keeps only the shares that were not resolved', () => {
      expect(kept.length).toBe(2);
    });
    it('retainedShares does not mutate its input', () => {
      expect(held.length).toBe(4);
    });
  });
});
