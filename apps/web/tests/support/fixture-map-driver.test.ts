import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type {
  MapDriver,
  MapDriverAttachment,
  MapDriverAttachOptions,
  MapFeatureDetails,
} from '@transitmapper/map';
import type { MapFeatureReferenceV1, MapPresentationStateV1 } from '@transitmapper/views';

const SOURCE_ID = 'fixture-transit';
const ROUTE_LAYER_ID = 'fixture-routes';
const STATION_LAYER_ID = 'fixture-stations';

const fixtureSource: GeoJSONSourceSpecification = {
  type: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'bus-line',
        properties: { kind: 'route', mode: 'bus', name: 'Crosstown bus' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-115.2, 36.15],
            [-115.14, 36.19],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'rail-line',
        properties: { kind: 'route', mode: 'rail', name: 'Regional rail' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-115.19, 36.2],
            [-115.12, 36.16],
          ],
        },
      },
      {
        type: 'Feature',
        id: 'central',
        properties: { kind: 'station', name: 'Central station' },
        geometry: { type: 'Point', coordinates: [-115.16, 36.18] },
      },
    ],
  },
};

const fixtureLayers: readonly LayerSpecification[] = [
  {
    id: ROUTE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'route'],
    paint: {
      'line-color': ['match', ['get', 'mode'], 'rail', '#7b2cbf', '#0077b6'],
      'line-width': 4,
    },
  },
  {
    id: STATION_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'station'],
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 6,
      'circle-stroke-color': '#111827',
      'circle-stroke-width': 2,
    },
  },
];

const featureDetails = new Map<string, MapFeatureDetails>([
  [
    'station:central',
    {
      reference: { source: 'fixture', kind: 'station', id: 'central' },
      title: 'Central station',
      fields: [{ label: 'Modes', value: 'Bus, Rail' }],
    },
  ],
  [
    'route:bus-line',
    {
      reference: { source: 'fixture', kind: 'route', id: 'bus-line' },
      title: 'Crosstown bus',
      fields: [{ label: 'Mode', value: 'Bus' }],
    },
  ],
  [
    'route:rail-line',
    {
      reference: { source: 'fixture', kind: 'route', id: 'rail-line' },
      title: 'Regional rail',
      fields: [{ label: 'Mode', value: 'Rail' }],
    },
  ],
]);

function stringFilterValues(value: unknown): string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : [];
}

function applyPresentation(map: MapLibreMap, state: MapPresentationStateV1): void {
  map.setFilter(ROUTE_LAYER_ID, [
    'in',
    ['get', 'mode'],
    ['literal', stringFilterValues(state.filters.modes)],
  ]);
  map.setLayoutProperty(
    STATION_LAYER_ID,
    'visibility',
    state.filters.stations === false ? 'none' : 'visible',
  );
}

function fixtureSelection(reference: MapFeatureReferenceV1 | undefined) {
  return reference?.source === 'fixture' ? { source: SOURCE_ID, id: reference.id } : null;
}

function installFixtureContent(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, fixtureSource);
  for (const layer of fixtureLayers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
}

function removeFixtureContent(map: MapLibreMap): void {
  for (const layer of [...fixtureLayers].reverse()) {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

class FixtureMapDriver implements MapDriver {
  readonly definition = {
    id: 'fixture',
    title: 'Fixture map',
    representations: [
      { id: 'network', label: 'Network' },
      { id: 'infrastructure', label: 'Infrastructure' },
    ],
    filters: [
      {
        kind: 'multi-select' as const,
        id: 'modes',
        label: 'Modes',
        options: [
          { id: 'bus', label: 'Bus' },
          { id: 'rail', label: 'Rail' },
        ],
        defaultValue: ['bus', 'rail'],
      },
      {
        kind: 'toggle' as const,
        id: 'stations',
        label: 'Stations',
        defaultValue: true,
      },
    ],
    attribution: [{ label: 'TransitMapper fixture' }],
  };

  attach(options: MapDriverAttachOptions): Promise<MapDriverAttachment> {
    if (options.signal.aborted) {
      return Promise.resolve({ resolveFeature: () => Promise.resolve(null), dispose() {} });
    }
    const map = options.host.map;
    installFixtureContent(map);
    applyPresentation(map, options.viewStore.getSnapshot());
    let selected = fixtureSelection(options.selection.getSnapshot());
    if (selected) map.setFeatureState(selected, { selected: true });
    const unsubscribeView = options.viewStore.subscribe((state) => applyPresentation(map, state));
    const unsubscribeSelection = options.selection.subscribe((reference) => {
      if (selected) map.removeFeatureState(selected, 'selected');
      selected = fixtureSelection(reference);
      if (selected) map.setFeatureState(selected, { selected: true });
    });
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unsubscribeView();
      unsubscribeSelection();
      if (selected) map.removeFeatureState(selected, 'selected');
      options.signal.removeEventListener('abort', dispose);
      removeFixtureContent(map);
    };
    options.signal.addEventListener('abort', dispose, { once: true });
    options.milestones.contentCommitted();
    options.milestones.interactive();
    return Promise.resolve({
      resolveFeature(reference, signal) {
        if (signal.aborted || reference.source !== 'fixture') return Promise.resolve(null);
        return Promise.resolve(featureDetails.get(`${reference.kind}:${reference.id}`) ?? null);
      },
      dispose,
    });
  }
}

export function createFixtureMapDriver(): MapDriver {
  return new FixtureMapDriver();
}
