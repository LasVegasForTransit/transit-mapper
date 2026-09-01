import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_MAXIMUM_RAW_BYTES,
  MAP_ENGINE_MAXIMUM_RAW_BYTES,
  evaluateChunkSizes,
  isMapEngineChunkName,
  maximumRawBytesForChunk,
  performanceChunkFileName,
  performanceChunkKind,
  performanceChunkName,
} from '../../src/perf/chunkPolicy';

describe('performance chunk policy', () => {
  it('gives stable cache boundaries to the map engine and React runtime', () => {
    expect(
      performanceChunkName(
        '/repo/node_modules/.pnpm/maplibre-gl@4.7.1/node_modules/maplibre-gl/dist/maplibre-gl.js',
      ),
    ).toBe('map-engine');
    expect(
      performanceChunkName(
        '/repo/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/index.js',
      ),
    ).toBe('react-runtime');
    expect(
      performanceChunkName(
        String.raw`C:\repo\node_modules\.pnpm\scheduler@0.23.2\node_modules\scheduler\index.js`,
      ),
    ).toBe('react-runtime');
    expect(
      performanceChunkName('/repo/apps/web/src/editor/editor-application.tsx'),
    ).toBeUndefined();
  });

  it('gives each stable workspace package its own normal budgeted cache chunk', () => {
    expect(performanceChunkName('/repo/packages/views/src/index.ts')).toBe('views');
    expect(performanceChunkName('/repo/packages/map/dist/map-surface.js')).toBe('map');
    expect(performanceChunkName('/repo/packages/map/src/state.ts')).toBe('map-state');
    expect(performanceChunkName('/repo/packages/map/dist/map-view-store.js')).toBe('map-state');
    expect(performanceChunkName('/repo/packages/workspace/src/workbench.tsx')).toBe('workspace');
    expect(performanceChunkName('/repo/packages/workspace/dist/media-query-store.js')).toBe(
      'media-query',
    );
    expect(performanceChunkName('/repo/packages/workspace/src/map-surface.tsx')).toBe(
      'map-surface',
    );
    expect(performanceChunkName('/repo/packages/map/dist/presentation.js')).toBe('map-display');
    expect(performanceChunkName('/repo/packages/renderer/src/render-presentation.ts')).toBe(
      'renderer-display',
    );
    expect(performanceChunkName('/repo/packages/map/dist/snapshot-map-driver.js')).toBe('map');
    expect(performanceChunkName('/repo/packages/renderer/src/layers/constants.ts')).toBe(
      'renderer-display',
    );
    expect(
      performanceChunkName('/repo/packages/renderer/src/workers/feature-projection-worker.ts'),
    ).toBe('renderer-projection');
    expect(
      performanceChunkName(
        '/repo/packages/renderer/dist/workers/feature-projection-worker-protocol.js',
      ),
    ).toBe('renderer-projection');
    expect(
      performanceChunkName('/repo/packages/renderer/src/workers/worker-request-lifecycle.ts'),
    ).toBe('renderer-projection');
    expect(performanceChunkName('/repo/packages/map/dist/sources/source-bank-layers.js')).toBe(
      'map-display',
    );
    expect(performanceChunkName('/repo/packages/renderer/src/scene-draft.ts')).toBe('renderer');
    expect(performanceChunkName('/repo/packages/map/src/document-map-feature-details.ts')).toBe(
      'feature-details',
    );
    expect(performanceChunkName('/repo/packages/renderer/dist/scene-publication.js')).toBe(
      'renderer',
    );
    expect(
      performanceChunkName(
        String.raw`C:\repo\packages\renderer\dist\projection\cooperative-render-job-scheduler.js`,
      ),
    ).toBe('renderer');
    expect(
      performanceChunkName('/repo/packages/core/src/render/render-preparation-update-plan.ts'),
    ).toBeUndefined();
    expect(performanceChunkName('/repo/apps/web/src/map/MapCanvas.tsx')).toBeUndefined();
    expect(performanceChunkName('/repo/apps/web/src/map/interactions.ts')).toBe(
      'editor-interactions',
    );
    expect(
      performanceChunkName('/repo/apps/web/src/map/system-feature-sources.ts'),
    ).toBeUndefined();
    expect(
      performanceChunkKind('assets/renderer-AbCd1234.js', [
        '/repo/packages/renderer/dist/scene-draft.js',
      ]),
    ).toBe('standard');
  });

  it('grants the map engine exception only to a pure MapLibre output', () => {
    const mapLibreModule =
      '/repo/node_modules/.pnpm/maplibre-gl@4.7.1/node_modules/maplibre-gl/dist/maplibre-gl.js';
    expect(performanceChunkKind('assets/map-engine-AbCd1234.js', [mapLibreModule])).toBe(
      'map-engine',
    );
    expect(
      performanceChunkKind('assets/map-engine-AbCd1234.js', [
        mapLibreModule,
        '/repo/apps/web/src/editor/editor-application.tsx',
      ]),
    ).toBe('standard');
    expect(performanceChunkKind('assets/main-AbCd1234.js', [mapLibreModule])).toBe('standard');
    expect(isMapEngineChunkName('assets/map-engine-helper-AbCd1234.js')).toBe(false);
    expect(maximumRawBytesForChunk({ kind: 'map-engine' })).toBe(MAP_ENGINE_MAXIMUM_RAW_BYTES);
    expect(maximumRawBytesForChunk({ kind: 'standard' })).toBe(DEFAULT_CHUNK_MAXIMUM_RAW_BYTES);
  });

  it('names the shared TransitMapper rendering graph for what it contains', () => {
    expect(
      performanceChunkFileName([
        '/repo/apps/web/src/network/fetchWithTimeout.ts',
        '/repo/packages/core/src/render/buildFeatures.ts',
      ]),
    ).toBe('assets/transit-rendering-[hash].js');
    expect(performanceChunkFileName(['/repo/apps/web/src/editor/editor-application.tsx'])).toBe(
      'assets/[name]-[hash].js',
    );
  });

  it('reports any emitted chunk that exceeds its explicit raw-byte limit', () => {
    expect(
      evaluateChunkSizes([
        {
          file: 'assets/map-engine-AbCd1234.js',
          rawBytes: 809_999,
          kind: 'map-engine',
        },
        {
          file: 'assets/main-AbCd1234.js',
          rawBytes: 500_001,
          kind: 'standard',
        },
      ]),
    ).toEqual([
      {
        file: 'assets/main-AbCd1234.js',
        rawBytes: 500_001,
        kind: 'standard',
        maximumRawBytes: 500_000,
        message: 'assets/main-AbCd1234.js is 500001 bytes; its chunk budget is 500000 bytes.',
      },
    ]);
  });
});
