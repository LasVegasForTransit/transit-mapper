import type { FeatureCollection } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { emptySystemFeatures, SRC_SERVICES } from '@transitmapper/renderer/layers';
import { lineSceneFeatures, projectSchemaV16LineScene } from '@transitmapper/renderer/line';
import type {
  FeatureProjectionClient,
  FeatureProjectionClientInput,
  FeatureProjectionResult,
} from '@transitmapper/renderer/projection-worker';
import { EMBED_FEATURE_SOURCES } from '../../src/embed/config';
import { installEmbedSceneSources, projectEmbedScene } from '../../src/embed/embed-map-runtime';

vi.mock('maplibre-gl', () => ({ default: {} }));

const OPERATIONAL_PROPERTIES = ['serviceId', 'patternId', 'wayId', 'modeId', 'typeId'];

function stringProperty(
  feature: { readonly properties: unknown },
  key: string,
): string | undefined {
  if (!feature.properties || typeof feature.properties !== 'object') return undefined;
  const value = (feature.properties as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

class EmbedSourceFake {
  constructor(public data: FeatureCollection) {}

  setData(data: FeatureCollection): void {
    this.data = data;
  }
}

class EmbedMapFake {
  readonly sources = new Map<string, EmbedSourceFake>();

  getSource(id: string): EmbedSourceFake | undefined {
    return this.sources.get(id);
  }

  addSource(id: string, source: { data: FeatureCollection }): void {
    this.sources.set(id, new EmbedSourceFake(source.data));
  }

  /** Drops every source the way MapLibre does when the host swaps the base
   * style, so a replay can be told apart from the first install. */
  loseStyle(): void {
    this.sources.clear();
  }

  serviceFeatures(): FeatureCollection['features'] {
    return this.sources.get(SRC_SERVICES)?.data.features ?? [];
  }
}

const embedMap = () => new EmbedMapFake();

/** The read-only camera the embed restores before it asks for a scene. */
const fittedMap = {
  getBounds: () => ({
    getSouthWest: () => ({ lng: -115.3, lat: 36.05 }),
    getNorthEast: () => ({ lng: -115.05, lat: 36.25 }),
  }),
  getZoom: () => 13,
  getCanvas: () => ({ clientWidth: 640, clientHeight: 400 }),
  getContainer: () => ({ clientWidth: 640, clientHeight: 400 }),
  getPixelRatio: () => 1,
};

/** Stands in for the projection worker while returning the real shared Line
 * scene, so what the embed paints is what the reader's worker resolves. */
function lineSceneProjection(): FeatureProjectionClient & {
  readonly requests: FeatureProjectionClientInput[];
} {
  const requests: FeatureProjectionClientInput[] = [];
  return {
    requests,
    async project(input: FeatureProjectionClientInput): Promise<FeatureProjectionResult> {
      requests.push(input);
      const scene = await projectSchemaV16LineScene({
        system: input.system,
        view: input.view,
        sceneRevision: 'embed-test',
      });
      return {
        features: { ...emptySystemFeatures(), services: lineSceneFeatures(scene) },
        counts: null,
      };
    },
    dispose: vi.fn(),
  };
}

function sharedCorridorSystem(): TransitSystem {
  const corridor = aRoad('maryland-parkway', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const weekday = aService('weekday-plan', [
    aPattern('weekday-pattern', [corridor], [corridor.id]),
  ]);
  const weekend = aService('weekend-plan', [
    aPattern('weekend-pattern', [corridor], [corridor.id]),
  ]);
  return aSystem({
    ways: [corridor],
    services: [weekday, weekend],
    lines: [
      {
        id: 'route-109',
        name: '109',
        color: '#00a8e8',
        serviceIds: [weekday.id, weekend.id],
      },
    ],
  });
}

async function paintedEmbedScene(system: TransitSystem): Promise<{
  readonly map: EmbedMapFake;
  readonly scene: SystemFeatures;
  readonly projection: ReturnType<typeof lineSceneProjection>;
}> {
  const projection = lineSceneProjection();
  const scene = await projectEmbedScene({
    projection,
    system,
    presentation: {
      viewMode: 'network',
      visibleModes: new Set(['bus']),
      visibleWayTypes: new Set(['road']),
    },
    map: fittedMap,
  });
  const map = embedMap();
  installEmbedSceneSources(map as unknown as MapLibreMap, scene);
  return { map, scene, projection };
}

describe('the embedded map scene', () => {
  it('asks the shared projection worker for the scene instead of building features itself', async () => {
    const { projection } = await paintedEmbedScene(sharedCorridorSystem());

    expect(projection.requests).toHaveLength(1);
    expect(projection.requests[0]?.sourceIds).toEqual(EMBED_FEATURE_SOURCES);
    expect(projection.requests[0]?.selection).toBeNull();
    expect(projection.requests[0]?.view.presentation.bounds.southwest[0]).toBeCloseTo(-115.3);
  });

  it('paints the Line stripes the worker returned and nothing it rebuilt', async () => {
    const { map, scene } = await paintedEmbedScene(sharedCorridorSystem());

    expect(map.serviceFeatures()).toBe(scene.services.features);
  });

  it('gives every painted route feature a Line identity and no operational identity', async () => {
    const { map } = await paintedEmbedScene(sharedCorridorSystem());
    const painted = map.serviceFeatures();

    expect(painted.length).toBeGreaterThan(0);
    for (const feature of painted) {
      expect(feature.properties).toHaveProperty('routeRole');
      for (const property of OPERATIONAL_PROPERTIES) {
        expect(feature.properties).not.toHaveProperty(property);
      }
    }
    expect(
      painted
        .filter((feature) => feature.properties?.routeRole === 'stripe')
        .every((feature) => typeof feature.properties?.lineId === 'string'),
    ).toBe(true);
  });

  it('paints one stripe for a Line whose corridor carries two ServicePlans', async () => {
    const { map } = await paintedEmbedScene(sharedCorridorSystem());
    const stripes = map
      .serviceFeatures()
      .filter((feature) => feature.properties?.routeRole === 'stripe');

    expect(stripes.map((feature) => stringProperty(feature, 'lineId'))).toEqual(['route-109']);
  });

  it('replays the accepted scene after a style swap rather than projecting a new one', async () => {
    const { map, scene, projection } = await paintedEmbedScene(sharedCorridorSystem());

    map.loseStyle();
    installEmbedSceneSources(map as unknown as MapLibreMap, scene);

    expect(map.serviceFeatures()).toBe(scene.services.features);
    expect(projection.requests).toHaveLength(1);
  });
});
