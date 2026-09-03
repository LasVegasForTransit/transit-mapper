import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { createMapViewStore } from '@transitmapper/map';
import { createSnapshotMapDriver } from '../src/snapshot-map-driver';
import { SRC_STATIONS, SRC_WAYS } from '@transitmapper/renderer/layers';
import {
  DocumentDriverClock,
  TestDocumentMap,
  advanceUntil,
  createAttachOptions,
  createProjectionWorker,
  projectedWayFeatures,
} from './support/document-map-driver.test';

const definition = {
  id: 'snapshot',
  title: 'Shared system',
  representations: [
    { id: 'network', label: 'Network' },
    { id: 'infrastructure', label: 'Infrastructure' },
  ],
  filters: [],
  attribution: [],
};

const layers: LayerSpecification[] = [
  { id: 'snapshot-ways', type: 'line', source: SRC_WAYS },
  { id: 'snapshot-stations', type: 'circle', source: SRC_STATIONS },
];

function createSystem() {
  return aSystem({
    id: 'shared-system',
    ways: [
      aRoad('road', [
        [-115.2, 36.1],
        [-115.1, 36.2],
      ]),
    ],
  });
}

describe('snapshot map driver', () => {
  it('publishes snapshot features produced by the projection worker', async () => {
    const map = new TestDocumentMap();
    const worker = createProjectionWorker(() =>
      Promise.resolve({ features: projectedWayFeatures('projected-snapshot'), counts: null }),
    );
    const driver = createSnapshotMapDriver({
      definition,
      system: createSystem(),
      layerSpecs: () => layers,
      resolvePresentation: (state) => ({
        viewMode: state.representationId as 'network' | 'infrastructure',
        visibleModes: new Set(state.filters.modes as string[]),
        visibleWayTypes: new Set(state.filters['way-types'] as string[]),
      }),
      scheduler: new DocumentDriverClock(),
      createFeatureProjectionWorker: () => worker,
    });

    const attachment = await driver.attach(createAttachOptions(map, [], []));

    expect(map.sourceData.get(SRC_WAYS)?.features[0]?.properties?.id).toBe('projected-snapshot');
    attachment.dispose();
  });

  it('restores a fixed system after a style change without a live document renderer', async () => {
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker(() =>
      Promise.resolve({ features: projectedWayFeatures('road'), counts: null }),
    );
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const restoreAfterStyle = vi.fn();
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    });
    const driver = createSnapshotMapDriver({
      definition,
      system: createSystem(),
      layerSpecs: () => layers,
      layerSpecsForPresentation: (catalog, presentation) =>
        presentation.viewMode === 'network' ? catalog.slice(0, 1) : catalog,
      resolvePresentation: (state) => ({
        viewMode: state.representationId as 'network' | 'infrastructure',
        visibleModes: new Set(state.filters.modes as string[]),
        visibleWayTypes: new Set(state.filters['way-types'] as string[]),
      }),
      scheduler: clock,
      createFeatureProjectionWorker: () => worker,
      attachSession: () => ({ restoreAfterStyle, dispose: vi.fn() }),
    });

    const attachment = await driver.attach(
      createAttachOptions(map, milestones, errors, { viewStore }),
    );

    expect(map.getSource(SRC_WAYS)).toBeDefined();
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['snapshot-ways']);
    expect(milestones).toEqual(['content', 'interactive']);

    viewStore.setRepresentationId('infrastructure');
    await advanceUntil(clock, map, () => map.getLayer('snapshot-stations') !== undefined);
    expect(map.sourceFeatureCount(SRC_WAYS)).toBeGreaterThan(0);
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual([
      'snapshot-ways',
      'snapshot-stations',
    ]);

    map.replaceStyle();
    expect(map.sourceFeatureCount(SRC_WAYS)).toBeGreaterThan(0);
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual([
      'snapshot-ways',
      'snapshot-stations',
    ]);
    expect(restoreAfterStyle).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);

    attachment.dispose();
    expect(map.listenerCount()).toBe(0);
  });
});
