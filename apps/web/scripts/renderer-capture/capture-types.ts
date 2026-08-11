import type { PerfProfileId } from '../../src/perf/types';
import type { RendererCaptureCase } from '../../src/perf/renderer-capture';
import type { RendererFixtureId } from '../../src/perf/renderer-fixtures';
import type { RendererStatsSnapshot } from '../../src/perf/renderer-stats';

export interface RendererCaptureViewport {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface RendererCaptureManifestEntry {
  id: string;
  file: string;
  profile: PerfProfileId | 'context' | 'filmstrip' | 'reference';
  theme: 'light' | 'dark';
  viewMode: RendererCaptureCase['viewMode'] | 'context';
  detail: RendererCaptureCase['detail'] | 'context' | 'filmstrip' | 'reference';
  zoom: number | null;
  fixtureId: RendererFixtureId | 'onboarding';
  viewport: RendererCaptureViewport;
  camera: { center: [number, number]; zoom: number } | null;
  rendererStats: RendererStatsSnapshot | null;
  sha256?: string;
}

export interface RendererCaptureManifest {
  schemaVersion: 1;
  phase: string;
  complete: boolean;
  selection: {
    profile: PerfProfileId | 'all';
    theme: 'light' | 'dark' | 'all';
  };
  generatedAt: string;
  source: { revision: string; dirty: boolean };
  basemap: 'local-blank-v1';
  captures: RendererCaptureManifestEntry[];
}
