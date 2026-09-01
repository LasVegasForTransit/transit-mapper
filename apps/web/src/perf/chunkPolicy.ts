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
  | 'map-host'
  | 'map-snapshot'
  | 'map-display'
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

interface StablePackageCarveOut {
  packageName: string;
  file: RegExp;
  chunk: PerformanceChunkName;
}

/**
 * Modules a light host may reach, named one file at a time. A module nobody
 * lists falls through to its package's own chunk, so forgetting an entry costs
 * a light host nothing; listing the heavy half instead would put every new
 * module in a light chunk by default, and a reader would silently inherit the
 * editor again.
 */
const STABLE_PACKAGE_CARVE_OUTS: readonly StablePackageCarveOut[] = [
  {
    packageName: 'map',
    file: /^(?:src|dist)\/(?:state|map-view-store|selection-controller|map-definition-state|map-driver|base-style-controller)\.[^.]+$/,
    chunk: 'map-state',
  },
  {
    packageName: 'map',
    file: /^(?:src|dist)\/(?:presentation|layers|sources\/source-bank|sources\/source-bank-layers)\.[^.]+$/,
    chunk: 'map-display',
  },
  {
    packageName: 'map',
    file: /^(?:src|dist)\/document-map-feature-details\.[^.]+$/,
    chunk: 'feature-details',
  },
  // Owning a MapLibre instance is separate from drawing a live scene into it.
  // The reader creates a map and never builds a frame, so these three must not
  // share a chunk with the drivers in `map`, every one of which statically
  // imports the renderer's scene machinery.
  {
    packageName: 'map',
    file: /^(?:src|dist)\/(?:map-runtime|deferred-map-driver|startup-milestones)\.[^.]+$/,
    chunk: 'map-host',
  },
  // The read-only snapshot path paints a System the projection Worker already
  // built, and reaches nothing past layer identities. Keeping it out of `map`
  // is what stops the reader from inheriting the live scene pipeline and
  // core's main-thread feature builder behind it. These four rode in
  // `renderer-display` until they changed packages; that carve-out matches on
  // package name, so the move dropped them into the heavy chunk with no
  // failure anywhere.
  {
    packageName: 'map',
    file: /^(?:src|dist)\/(?:snapshot|snapshot-map-driver|document-layer-plan|render-visibility)\.[^.]+$/,
    chunk: 'map-snapshot',
  },
  {
    packageName: 'workspace',
    file: /^(?:src|dist)\/media-query-store\.[^.]+$/,
    chunk: 'media-query',
  },
  {
    packageName: 'workspace',
    file: /^(?:src|dist)\/map-surface\.[^.]+$/,
    chunk: 'map-surface',
  },
  {
    packageName: 'renderer',
    file: /^(?:src|dist)\/workers\/(?:feature-projection-worker|feature-projection-worker-protocol|worker-request-lifecycle)\.[^.]+$/,
    chunk: 'renderer-projection',
  },
  {
    packageName: 'renderer',
    file: /^(?:src|dist)\/(?:render-presentation|layers|layers\/constants|system-feature-sources)\.[^.]+$/,
    chunk: 'renderer-display',
  },
];

function isReactRuntimeModule(moduleId: string): boolean {
  return (
    moduleId.includes('/node_modules/.pnpm/react@') ||
    moduleId.includes('/node_modules/.pnpm/react-dom@') ||
    moduleId.includes('/node_modules/.pnpm/scheduler@')
  );
}

export function performanceChunkName(moduleId: string): PerformanceChunkName | undefined {
  const normalizedId = normalizedModuleId(moduleId);
  if (isMapEngineModule(normalizedId)) return 'map-engine';
  const carveOut = STABLE_PACKAGE_CARVE_OUTS.find((candidate) =>
    stablePackageModule(normalizedId, candidate.packageName, candidate.file),
  );
  if (carveOut) return carveOut.chunk;
  const packageChunk = stablePackageChunk(normalizedId);
  if (packageChunk) return packageChunk;
  if (isEditorInteractionModule(normalizedId)) return 'editor-interactions';
  if (isReactRuntimeModule(normalizedId)) return 'react-runtime';
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
