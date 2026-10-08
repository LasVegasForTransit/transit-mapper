export const TURBO_GLOBAL_DEPENDENCIES: string[];
export function parseTurboCache(source: string): Record<string, unknown> & {
  globalDependencies?: string[];
};
export function turboCacheProblem(source: string | null | undefined): string | undefined;
export function turboCacheRequired(release: string | null | undefined): boolean;
