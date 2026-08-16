export interface BuildInfo {
  version: string;
  repositoryUrl: string;
  commitSha: string | null;
  commitUrl: string | null;
  builtAt: string;
  dirty: boolean;
  copyrightNotice: string;
  releaseTag: string | null;
  releaseUrl: string | null;
  attestationsUrl: string;
  performanceSampling: {
    /** Emergency build-time kill switch. Runtime privacy and origin gates
     * still apply when this is enabled. */
    enabled: boolean;
    ordinaryBasisPoints: number;
    releaseBasisPoints: number;
    boostUntil: string | null;
  };
}

declare const __TRANSITMAPPER_BUILD_INFO__: BuildInfo;

/** Vite replaces this constant in every editor build. Keeping the access
 * behind a function lets component tests supply explicit fixtures without
 * teaching Vitest a second, inevitably drifting copy of the build pipeline. */
export function currentBuildInfo(): BuildInfo {
  if (typeof __TRANSITMAPPER_BUILD_INFO__ === 'undefined') {
    throw new Error('TransitMapper build metadata was not injected by Vite');
  }
  return __TRANSITMAPPER_BUILD_INFO__;
}
