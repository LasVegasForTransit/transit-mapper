/** Monotonic observation for one immutable renderer cache. */
export interface RenderIndexCacheDiagnostics {
  readonly buildCount: number;
  readonly cacheHitCount: number;
}

export interface RenderIndexCacheDiagnosticCounter {
  readonly snapshot: () => RenderIndexCacheDiagnostics;
  readonly reset: () => void;
  readonly recordBuild: () => void;
  readonly recordCacheHit: () => void;
}

/** Creates a counter seam without owning or clearing the cache it observes. */
export function createRenderIndexCacheDiagnosticCounter(): RenderIndexCacheDiagnosticCounter {
  let buildCount = 0;
  let cacheHitCount = 0;
  return {
    snapshot: () => ({ buildCount, cacheHitCount }),
    reset: () => {
      buildCount = 0;
      cacheHitCount = 0;
    },
    recordBuild: () => buildCount++,
    recordCacheHit: () => cacheHitCount++,
  };
}
