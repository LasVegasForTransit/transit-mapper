import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
  LYR_LANE_SURFACES,
  LYR_STATIONS,
  LYR_STATION_LABELS_MAJOR,
  SRC_LANES,
  SRC_STATIONS,
  bankedLayerId,
  bankedSourceId,
} from '@transitmapper/map/layers';
import { editorMapOverlaySnapshot } from '../../src/map/editor-map-instrumentation';

const CATALOG: readonly LayerSpecification[] = [
  {
    id: LYR_STATIONS,
    type: 'circle',
    source: SRC_STATIONS,
  },
  {
    id: LYR_STATION_LABELS_MAJOR,
    type: 'symbol',
    source: SRC_STATIONS,
  },
  {
    id: LYR_LANE_SURFACES,
    type: 'fill',
    source: SRC_LANES,
  },
];

describe('editor map instrumentation', () => {
  it('treats uninstalled layers from another representation as outside overlay health', () => {
    const installedLayerIds = new Set([
      bankedLayerId(LYR_STATIONS, 'a'),
      bankedLayerId(LYR_STATIONS, 'b'),
      bankedLayerId(LYR_STATION_LABELS_MAJOR, 'a'),
      bankedLayerId(LYR_STATION_LABELS_MAJOR, 'b'),
    ]);
    const stationSourceId = bankedSourceId(SRC_STATIONS, 'a');
    const snapshot = editorMapOverlaySnapshot({
      map: {
        getLayer: (id: string) => (installedLayerIds.has(id) ? { id } : undefined),
        getSource: (id: string) => (id === stationSourceId ? { id } : undefined),
        isSourceLoaded: (id: string) => id === stationSourceId,
        querySourceFeatures: () => [{ id: 'station' }],
      } as never,
      renderer: {
        activeSourceId: () => stationSourceId,
        activeLayerId: (id: string) => bankedLayerId(id, 'a'),
      } as never,
      catalog: CATALOG,
      representationId: 'network',
    });

    expect(snapshot).toMatchObject({
      sourceExists: true,
      layerExists: true,
      symbolLayerExists: true,
      overlayHealthy: true,
      rendererLayerCount: 4,
      expectedRendererLayerCount: 4,
      sourceLoaded: true,
      featureCount: 1,
    });
  });
});
