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
    expect(performanceChunkName('/repo/apps/web/src/App.tsx')).toBeUndefined();
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
        '/repo/apps/web/src/App.tsx',
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
    expect(performanceChunkFileName(['/repo/apps/web/src/App.tsx'])).toBe(
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
