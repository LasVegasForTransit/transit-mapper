import { describe, expect, it } from 'vitest';
import { collectWayTrims, junctionGeometry } from '../../src/geometry/junctions';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { profileWidthM } from '../../src/model/profile';
import { buildFeatures, type RenderViewOptions } from '../../src/render/buildFeatures';
import { widthPxAtZ14 } from '../../src/render/constants';
import { serviceJunctionConnectors } from '../../src/render/service-junction-connectors';
import { renderDomainIdentity } from '../../src/render/render-identity';
import { resolveStaticVisualScene } from '../../src/render/static-visual-scene';
import { renderFeatureDomainIdentities } from '../../src/render/system-render-scene';
import type { LngLat, Node } from '../../src/model/system';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

function propertiesOf(feature: {
  readonly properties: Record<string, unknown> | null;
}): Record<string, unknown> {
  if (feature.properties === null) throw new Error('rendered test feature must carry properties');
  return feature.properties;
}

function throughJunction() {
  const coord: LngLat = [-115.16, 36.14];
  const west = aRoad('west', [[-115.2, 36.14], coord]);
  const east = aRoad('east', [coord, [-115.12, 36.14]]);
  const south = aRoad('south', [[-115.16, 36.1], coord]);
  const north = aRoad('north', [coord, [-115.16, 36.18]]);
  const node: Node = {
    id: 'junction',
    coord,
    refs: [
      { wayId: west.id, pointIndex: 1 },
      { wayId: east.id, pointIndex: 0 },
      { wayId: south.id, pointIndex: 1 },
      { wayId: north.id, pointIndex: 0 },
    ],
  };
  const waysById = new Map([west, east, south, north].map((way) => [way.id, way]));
  const geometry = junctionGeometry(node, waysById);
  if (!geometry) throw new Error('fixture must form a junction');
  return {
    node,
    west,
    east,
    south,
    north,
    waysById,
    trims: collectWayTrims([geometry]),
  };
}

describe('service junction connectors', () => {
  it('routes a service between its resolved lane endpoints through the junction', () => {
    const { node, west, east, waysById, trims } = throughJunction();
    const service = aService('route', [aPattern('pattern', [west, east], [west.id, east.id])]);

    const connectors = serviceJunctionConnectors({
      services: [service],
      nodes: [node],
      waysById,
      trims,
      turnRestrictions: {},
    });

    const outbound = connectors.find(
      (connector) =>
        connector.serviceId === service.id &&
        connector.nodeId === node.id &&
        connector.from.wayId === west.id &&
        connector.to.wayId === east.id,
    );
    expect(outbound).toBeDefined();
    expect(outbound?.path.length).toBeGreaterThan(2);
  });

  it('does not bridge a service leg that terminates before the junction', () => {
    const { node, west, east, waysById, trims } = throughJunction();
    const service = aService('route', [
      {
        id: 'partial-pattern',
        sections: [
          {
            kind: 'shared',
            legs: [
              {
                wayId: west.id,
                direction: 'withPoints',
                extent: { kind: 'stretch', fromT: 0, toT: 0.8 },
                lane: { kind: 'auto' },
              },
              {
                wayId: east.id,
                direction: 'withPoints',
                extent: { kind: 'whole' },
                lane: { kind: 'auto' },
              },
            ],
          },
        ],
      },
    ]);

    expect(
      serviceJunctionConnectors({
        services: [service],
        nodes: [node],
        waysById,
        trims,
        turnRestrictions: {},
      }),
    ).toEqual([]);
  });

  it('draws the resolved connector as Street-tier service geometry', () => {
    const { node, west, east, south, north, waysById, trims } = throughJunction();
    const service = aService('route', [aPattern('pattern', [west, east], [west.id, east.id])]);
    const widthAtZ14 = widthPxAtZ14(profileWidthM(west.profile), west.points[0]?.[1] ?? 0);
    const view: RenderViewOptions = {
      viewMode: 'infrastructure',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
      presentation: {
        bounds: { southwest: [-115.3, 36], northeast: [-115, 36.3] },
        zoom: 14 + Math.log2(16 / widthAtZ14),
        viewportWidthPx: 1_440,
        viewportHeightPx: 900,
        displayedWidthPx: 1_440,
        displayedHeightPx: 900,
        pixelRatio: 1,
      },
    };

    const features = buildFeatures(
      aSystem({ ways: [west, east, south, north], nodes: [node], services: [service] }),
      null,
      [],
      view,
    );
    const connector = features.services.features.find(
      (feature) =>
        propertiesOf(feature).serviceId === service.id &&
        propertiesOf(feature).pathRole === `junction:${node.id}`,
    );

    expect(connector).toBeDefined();
    if (!connector) return;
    const expectedConnector = serviceJunctionConnectors({
      services: [service],
      nodes: [node],
      waysById,
      trims,
      turnRestrictions: {},
    }).find((candidate) => candidate.from.wayId === west.id && candidate.to.wayId === east.id);
    expect(expectedConnector).toBeDefined();
    expect(connector.geometry.coordinates).toEqual(expectedConnector?.path);
    expect(connector.geometry.coordinates.length).toBeGreaterThan(2);
    expect(propertiesOf(connector).renderTier).toBe('street');
    const staticScene = resolveStaticVisualScene({
      revision: 'test',
      features,
      presentation: view.presentation,
    });
    expect(staticScene.visuals.some((visual) => visual.featureId === String(connector.id))).toBe(
      true,
    );

    const hitConnector = features.services.features.find(
      (feature) =>
        propertiesOf(feature).serviceId === service.id &&
        propertiesOf(feature).pathRole === `junction:${node.id}` &&
        propertiesOf(feature).hitTarget === true,
    );
    expect(hitConnector).toBeDefined();
    expect(hitConnector?.geometry).toEqual(connector.geometry);
    expect(renderFeatureDomainIdentities('services', connector)).toEqual(
      expect.arrayContaining([
        renderDomainIdentity('service', service.id),
        renderDomainIdentity('way', west.id),
        renderDomainIdentity('node', node.id),
      ]),
    );

    const trimmedLaneServices = features.services.features.filter(
      (feature) =>
        propertiesOf(feature).serviceId === service.id &&
        propertiesOf(feature).renderTier === 'street' &&
        propertiesOf(feature).w14 !== undefined &&
        propertiesOf(feature).pathRole !== `junction:${node.id}` &&
        propertiesOf(feature).hitTarget !== true,
    );
    expect(trimmedLaneServices).not.toEqual([]);
    expect(
      trimmedLaneServices.every((feature) =>
        feature.geometry.coordinates.every(
          ([lng, lat]) => lng !== node.coord[0] || lat !== node.coord[1],
        ),
      ),
    ).toBe(true);
  });
});
