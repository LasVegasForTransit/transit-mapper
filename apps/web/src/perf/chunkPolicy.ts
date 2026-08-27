export type PerformanceChunkName =
  | 'map-engine'
  | 'react-runtime'
  | 'views'
  | 'map'
  | 'map-state'
  | 'media-query'
  | 'workspace'
  | 'map-surface'
  | 'renderer'
  | 'renderer-display'
  | 'renderer-projection'
  | 'feature-details'
  | 'editor-interactions';
export type PerformanceChunkKind = 'map-engine' | 'standard';

export const DEFAULT_CHUNK_MAXIMUM_RAW_BYTES = 500_000;
export const MAP_ENGINE_MAXIMUM_RAW_BYTES = 810_000;

export interface PerformanceChunkSize {
  file: string;
  rawBytes: number;
  kind: PerformanceChunkKind;
}

export interface PerformanceChunkViolation extends PerformanceChunkSize {
  maximumRawBytes: number;
  message: string;
}

function normalizedModuleId(moduleId: string): string {
  return moduleId.replaceAll('\\', '/');
}

function isMapEngineModule(moduleId: string): boolean {
  return normalizedModuleId(moduleId).includes('/node_modules/.pnpm/maplibre-gl@');
}

function stablePackageChunk(moduleId: string): PerformanceChunkName | undefined {
  const match = /\/packages\/(views|map|workspace|renderer)\/(?:src|dist)\//.exec(
    normalizedModuleId(moduleId),
  );
  return match?.[1] as PerformanceChunkName | undefined;
}

function stablePackageModule(moduleId: string, packageName: string, file: RegExp): boolean {
  const normalizedId = normalizedModuleId(moduleId);
  const marker = `/packages/${packageName}/`;
  const packageOffset = normalizedId.indexOf(marker);
  if (packageOffset < 0) return false;
  const packagePath = normalizedId.slice(packageOffset + marker.length);
  return /^(?:src|dist)\//.test(packagePath) && file.test(packagePath);
}

/**
 * Pointer grammar is a stable, self-contained runtime with different churn
 * from the editor shell. Keeping it separately cacheable prevents a renderer
 * change from redownloading every gesture command, while retaining the normal
 * 500 kB JavaScript limit that applies to every non-MapLibre chunk.
 */
function isEditorInteractionModule(moduleId: string): boolean {
  return normalizedModuleId(moduleId).endsWith('/apps/web/src/map/interactions.ts');
}

export function performanceChunkName(moduleId: string): PerformanceChunkName | undefined {
  const normalizedId = normalizedModuleId(moduleId);
  if (isMapEngineModule(normalizedId)) return 'map-engine';
  if (
    stablePackageModule(
      normalizedId,
      'map',
      /^(?:src|dist)\/(?:state|map-view-store|selection-controller|map-definition-state|map-driver)\.[^.]+$/,
    )
  ) {
    return 'map-state';
  }
  if (stablePackageModule(normalizedId, 'workspace', /^(?:src|dist)\/media-query-store\.[^.]+$/)) {
    return 'media-query';
  }
  if (stablePackageModule(normalizedId, 'workspace', /^(?:src|dist)\/map-surface\.[^.]+$/)) {
    return 'map-surface';
  }
  if (
    stablePackageModule(
      normalizedId,
      'renderer',
      /^(?:src|dist)\/workers\/(?:feature-projection-worker|feature-projection-worker-protocol|worker-request-lifecycle)\.[^.]+$/,
    )
  ) {
    return 'renderer-projection';
  }
  if (
    stablePackageModule(
      normalizedId,
      'renderer',
      /^(?:src|dist)\/(?:document-layer-plan|presentation|render-presentation|render-visibility|snapshot|snapshot-map-driver|layers|layers\/constants|sources\/source-bank|sources\/source-bank-layers|system-feature-sources)\.[^.]+$/,
    )
  ) {
    return 'renderer-display';
  }
  if (
    stablePackageModule(
      normalizedId,
      'renderer',
      /^(?:src|dist)\/document-map-feature-details\.[^.]+$/,
    )
  ) {
    return 'feature-details';
  }
  const packageChunk = stablePackageChunk(normalizedId);
  if (packageChunk) return packageChunk;
  if (isEditorInteractionModule(normalizedId)) return 'editor-interactions';
  if (
    normalizedId.includes('/node_modules/.pnpm/react@') ||
    normalizedId.includes('/node_modules/.pnpm/react-dom@') ||
    normalizedId.includes('/node_modules/.pnpm/scheduler@')
  ) {
    return 'react-runtime';
  }
  return undefined;
}

export function isMapEngineChunkName(file: string): boolean {
  return /(?:^|\/)map-engine-[A-Za-z0-9_-]{8}\.js$/.test(file);
}

export function performanceChunkKind(file: string, moduleIds: string[]): PerformanceChunkKind {
  return isMapEngineChunkName(file) && moduleIds.length > 0 && moduleIds.every(isMapEngineModule)
    ? 'map-engine'
    : 'standard';
}

export function maximumRawBytesForChunk(chunk: Pick<PerformanceChunkSize, 'kind'>): number {
  return chunk.kind === 'map-engine'
    ? MAP_ENGINE_MAXIMUM_RAW_BYTES
    : DEFAULT_CHUNK_MAXIMUM_RAW_BYTES;
}

export function performanceChunkFileName(moduleIds: string[]): string {
  const normalizedIds = moduleIds.map(normalizedModuleId);
  const isSharedRenderingGraph =
    normalizedIds.some((moduleId) => moduleId.endsWith('/src/network/fetchWithTimeout.ts')) &&
    normalizedIds.some((moduleId) => moduleId.includes('/packages/core/src/render/'));
  return isSharedRenderingGraph ? 'assets/transit-rendering-[hash].js' : 'assets/[name]-[hash].js';
}

export function evaluateChunkSizes(chunks: PerformanceChunkSize[]): PerformanceChunkViolation[] {
  return chunks.flatMap((chunk) => {
    const maximumRawBytes = maximumRawBytesForChunk(chunk);
    if (chunk.rawBytes <= maximumRawBytes) return [];
    return [
      {
        ...chunk,
        maximumRawBytes,
        message:
          `${chunk.file} is ${chunk.rawBytes} bytes; ` +
          `its chunk budget is ${maximumRawBytes} bytes.`,
      },
    ];
  });
}
