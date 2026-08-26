import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import {
  createMapStartupMilestones,
  createMapViewStore,
  createSelectionController,
} from '@transitmapper/map';
import { createFixtureMapDriver } from '../../support/fixture-map-driver.test';

function createMapHarness() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  const addSource = vi.fn((id: string) => sources.add(id));
  const addLayer = vi.fn((layer: { id: string }) => layers.add(layer.id));
  const removeFeatureState = vi.fn();
  const removeLayer = vi.fn((id: string) => layers.delete(id));
  const removeSource = vi.fn((id: string) => sources.delete(id));
  const setFeatureState = vi.fn();
  const setFilter = vi.fn();
  const setLayoutProperty = vi.fn();
  const map = {
    addLayer,
    addSource,
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id } : undefined),
    off: vi.fn(),
    on: vi.fn(),
    removeFeatureState,
    removeLayer,
    removeSource,
    setFeatureState,
    setFilter,
    setLayoutProperty,
  } as unknown as MapLibreMap;
  return {
    addLayer,
    addSource,
    map,
    removeFeatureState,
    removeLayer,
    removeSource,
    setFeatureState,
    setFilter,
    setLayoutProperty,
  };
}

function createPorts() {
  return {
    viewStore: createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.17, 36.17], zoom: 11 },
      representationId: 'network',
      filters: { modes: ['bus', 'rail'], stations: true },
    }),
    selection: createSelectionController(),
    milestones: createMapStartupMilestones(),
  };
}

describe('the non-document map driver fixture', () => {
  it('registers bounded content and resolves its feature details', async () => {
    const driver = createFixtureMapDriver();
    const harness = createMapHarness();
    const ports = createPorts();
    const attachment = await driver.attach({
      host: { map: harness.map, reportError: vi.fn() },
      ...ports,
      milestones: ports.milestones,
      signal: new AbortController().signal,
    });

    expect(harness.addSource).toHaveBeenCalledOnce();
    expect(harness.addLayer).toHaveBeenCalledTimes(2);
    expect(ports.milestones.getSnapshot()).toEqual({
      contentCommitted: true,
      interactive: true,
    });
    await expect(
      attachment.resolveFeature(
        { source: 'fixture', kind: 'station', id: 'central' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      title: 'Central station',
      fields: [{ label: 'Modes', value: 'Bus, Rail' }],
    });

    attachment.dispose();
  });

  it('applies View filters and selection through injected ports', async () => {
    const driver = createFixtureMapDriver();
    const harness = createMapHarness();
    const ports = createPorts();
    const attachment = await driver.attach({
      host: { map: harness.map, reportError: vi.fn() },
      ...ports,
      milestones: ports.milestones,
      signal: new AbortController().signal,
    });

    ports.viewStore.setFilter('modes', ['rail']);
    ports.viewStore.setFilter('stations', false);
    ports.selection.select({ source: 'fixture', kind: 'station', id: 'central' });

    expect(harness.setFilter).toHaveBeenLastCalledWith('fixture-routes', [
      'in',
      ['get', 'mode'],
      ['literal', ['rail']],
    ]);
    expect(harness.setLayoutProperty).toHaveBeenLastCalledWith(
      'fixture-stations',
      'visibility',
      'none',
    );
    expect(harness.setFeatureState).toHaveBeenLastCalledWith(
      { source: 'fixture-transit', id: 'central' },
      { selected: true },
    );

    attachment.dispose();
    expect(harness.removeLayer).toHaveBeenCalledTimes(2);
    expect(harness.removeSource).toHaveBeenCalledWith('fixture-transit');
  });
});
