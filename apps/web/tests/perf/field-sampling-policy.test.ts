import { describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_SAMPLE_STORAGE_PREFIX,
  buildSampleDecision,
  performanceSurfaceForPath,
  type SampleDecisionMemory,
} from '../../src/perf/field-sampling-policy';

const BUILD_ID = 'v1.2.3+0123456';
const RELEASED_AT = Date.parse('2026-08-13T00:00:00.000Z');

function cryptoAt(value: number): Pick<Crypto, 'getRandomValues'> {
  return {
    getRandomValues: vi.fn((array: Uint32Array) => {
      array[0] = value;
      return array;
    }) as Crypto['getRandomValues'],
  };
}

function memory(): SampleDecisionMemory {
  return new Map<string, '0' | '1'>();
}

describe('field sampling policy', () => {
  it('normalizes only shared paths to the share surface', () => {
    expect(performanceSurfaceForPath('/')).toBe('editor');
    expect(performanceSurfaceForPath('/new')).toBe('editor');
    expect(performanceSurfaceForPath('/s/abc123')).toBe('share');
    expect(performanceSurfaceForPath('/s/abc123/')).toBe('share');
    expect(performanceSurfaceForPath('/settings')).toBe('editor');
  });

  it('uses the five-percent boundary during the first release day', () => {
    const beforeBoundary = buildSampleDecision({
      buildId: BUILD_ID,
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: new Date(RELEASED_AT + 86_400_000).toISOString(),
      now: RELEASED_AT + 1,
      crypto: cryptoAt(214_748_364),
      storage: null,
      memory: memory(),
    });
    const atBoundary = buildSampleDecision({
      buildId: `${BUILD_ID}.boundary`,
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: new Date(RELEASED_AT + 86_400_000).toISOString(),
      now: RELEASED_AT + 1,
      crypto: cryptoAt(214_748_365),
      storage: null,
      memory: memory(),
    });

    expect(beforeBoundary).toBe(true);
    expect(atBoundary).toBe(false);
  });

  it('uses the one-percent boundary once the release boost expires', () => {
    const options = {
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: new Date(RELEASED_AT + 86_400_000).toISOString(),
      now: RELEASED_AT + 86_400_000,
      storage: null,
    };

    expect(
      buildSampleDecision({
        ...options,
        buildId: BUILD_ID,
        crypto: cryptoAt(42_949_672),
        memory: memory(),
      }),
    ).toBe(true);
    expect(
      buildSampleDecision({
        ...options,
        buildId: `${BUILD_ID}.boundary`,
        crypto: cryptoAt(42_949_673),
        memory: memory(),
      }),
    ).toBe(false);
  });

  it('stores only a build-scoped zero or one and reuses it for the tab', () => {
    const values = new Map<string, string>();
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: vi.fn<(key: string) => string | null>((key) => values.get(key) ?? null),
      setItem: vi.fn<(key: string, value: string) => void>((key, value) => {
        values.set(key, value);
      }),
    };
    const crypto = cryptoAt(0);
    const fallback = memory();
    const options = {
      buildId: BUILD_ID,
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: null,
      now: RELEASED_AT,
      crypto,
      storage,
      memory: fallback,
    };

    expect(buildSampleDecision(options)).toBe(true);
    expect(buildSampleDecision(options)).toBe(true);
    expect(values).toEqual(new Map([[`${PERFORMANCE_SAMPLE_STORAGE_PREFIX}${BUILD_ID}`, '1']]));
    expect(crypto.getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('keeps a stable in-memory decision when session storage is blocked', () => {
    const storage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked');
      }),
      setItem: vi.fn(() => {
        throw new DOMException('blocked');
      }),
    };
    const crypto = cryptoAt(0xffff_ffff);
    const fallback = memory();
    const options = {
      buildId: BUILD_ID,
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: null,
      now: RELEASED_AT,
      crypto,
      storage,
      memory: fallback,
    };

    expect(buildSampleDecision(options)).toBe(false);
    expect(buildSampleDecision(options)).toBe(false);
    expect(crypto.getRandomValues).toHaveBeenCalledTimes(1);
    expect([...fallback.values()]).toEqual(['0']);
  });
});
