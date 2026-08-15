import type { PerformanceSurface } from '@transitmapper/core/performance/contract';

export const PERFORMANCE_SAMPLE_STORAGE_PREFIX = 'transitmapper:performance-sample:';

export type SampleDecisionMemory = Map<string, '0' | '1'>;

interface BuildSampleDecisionOptions {
  buildId: string;
  ordinaryBasisPoints: number;
  releaseBasisPoints: number;
  boostUntil: string | null;
  now: number;
  crypto: Pick<Crypto, 'getRandomValues'>;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  memory: SampleDecisionMemory;
}

export function performanceSurfaceForPath(pathname: string): PerformanceSurface {
  return /^\/s(?:\/|$)/.test(pathname) ? 'share' : 'editor';
}

function readStoredDecision(
  key: string,
  storage: BuildSampleDecisionOptions['storage'],
): '0' | '1' | null {
  try {
    const value = storage?.getItem(key);
    return value === '0' || value === '1' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredDecision(
  key: string,
  decision: '0' | '1',
  storage: BuildSampleDecisionOptions['storage'],
): void {
  try {
    storage?.setItem(key, decision);
  } catch {
    // Private or restricted browsing can block storage. The module-scoped
    // fallback still gives this page a stable decision without an identifier.
  }
}

function basisPointsAt(
  now: number,
  ordinaryBasisPoints: number,
  releaseBasisPoints: number,
  boostUntil: string | null,
): number {
  if (!boostUntil) return ordinaryBasisPoints;
  const cutoff = Date.parse(boostUntil);
  return Number.isFinite(cutoff) && now < cutoff ? releaseBasisPoints : ordinaryBasisPoints;
}

/** Choose once per build and tab. Only the boolean survives; the random word
 * is neither persisted nor returned, so it cannot become a visitor id. */
export function buildSampleDecision(options: BuildSampleDecisionOptions): boolean {
  const key = `${PERFORMANCE_SAMPLE_STORAGE_PREFIX}${options.buildId}`;
  const stored = readStoredDecision(key, options.storage) ?? options.memory.get(key) ?? null;
  if (stored) return stored === '1';

  const random = new Uint32Array(1);
  options.crypto.getRandomValues(random);
  const basisPoints = basisPointsAt(
    options.now,
    options.ordinaryBasisPoints,
    options.releaseBasisPoints,
    options.boostUntil,
  );
  const selected = random[0] / 0x1_0000_0000 < basisPoints / 10_000;
  const decision = selected ? '1' : '0';
  options.memory.set(key, decision);
  writeStoredDecision(key, decision, options.storage);
  return selected;
}
