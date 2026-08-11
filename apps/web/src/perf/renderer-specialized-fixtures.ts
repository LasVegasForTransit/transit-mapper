import { LINE_COLORS } from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { LngLat, Node, Service, TransitSystem, Way } from '@transitmapper/core/model/system';
import {
  rendererSystem,
  rendererWay,
  sharedEndpointNodes,
  singleWayService,
} from './renderer-fixture-builders';
import { createPortMason } from './renderer-port-mason-fixture';

export function createJunctionFixture(id: string, angles: readonly number[]): TransitSystem {
  const center: LngLat = [-115.176, 36.13];
  const ways = angles.map((angle, index) => {
    const radians = (angle * Math.PI) / 180;
    const outer: LngLat = [
      center[0] + Math.cos(radians) * 0.0018,
      center[1] + Math.sin(radians) * 0.00145,
    ];
    return rendererWay(`${id}-arm-${index}`, [outer, center]);
  });
  const node: Node = {
    id: `${id}-node`,
    coord: center,
    refs: ways.map((way) => ({ wayId: way.id, pointIndex: 1 })),
  };
  return rendererSystem({ id, name: id, viewport: { center, zoom: 17.5 }, ways, nodes: [node] });
}

export function createGradeStack(): TransitSystem {
  const center: LngLat = [-115.176, 36.13];
  const ways = [
    rendererWay(
      'grade-underground',
      [
        [-115.178, 36.129],
        [-115.174, 36.131],
      ],
      { grade: 'underground' },
    ),
    rendererWay('grade-at-grade', [
      [-115.178, 36.131],
      [-115.174, 36.129],
    ]),
    rendererWay(
      'grade-elevated',
      [
        [-115.176, 36.1275],
        [-115.176, 36.1325],
      ],
      { grade: 'elevated', typeId: 'lightRail' },
    ),
  ];
  return rendererSystem({
    id: 'grade-stack',
    name: 'Grade stack',
    viewport: { center, zoom: 17 },
    ways,
  });
}

export function createNoisyCurves(): TransitSystem {
  const center: LngLat = [-115.176, 36.13];
  const ways = [
    rendererWay(
      'curve-clean',
      [
        [-115.18, 36.128],
        [-115.176, 36.132],
        [-115.172, 36.128],
      ],
      { geometry: 'curved' },
    ),
    rendererWay(
      'curve-noisy',
      [
        [-115.18, 36.127],
        [-115.1785, 36.1281],
        [-115.1774, 36.1277],
        [-115.1762, 36.129],
        [-115.1749, 36.1283],
        [-115.1734, 36.1292],
        [-115.172, 36.127],
      ],
      { geometry: 'freeform' },
    ),
  ];
  return rendererSystem({
    id: 'noisy-curves',
    name: 'Noisy curves',
    viewport: { center, zoom: 16.5 },
    ways,
  });
}

export function createRailGuideway(): TransitSystem {
  const center: LngLat = [-115.176, 36.13];
  const ways = [
    rendererWay(
      'rail-guideway-a',
      [
        [-115.181, 36.127],
        [-115.176, 36.13],
        [-115.171, 36.133],
      ],
      { typeId: 'lightRail', geometry: 'curved' },
    ),
    rendererWay(
      'rail-guideway-b',
      [
        [-115.176, 36.13],
        [-115.173, 36.126],
      ],
      { typeId: 'lightRail' },
    ),
  ];
  return rendererSystem({
    id: 'rail-guideway',
    name: 'Rail guideway',
    viewport: { center, zoom: 17 },
    ways,
    nodes: sharedEndpointNodes('rail-guideway', ways),
  });
}

function branchService(
  trunk: Way,
  branch: Way,
  identity: Pick<Service, 'id' | 'name' | 'color'>,
): Service {
  return {
    ...identity,
    modeId: 'bus',
    frequencyMinutes: 8,
    patterns: [
      {
        id: `${identity.id}-pattern`,
        sections: oneSection([wholeLeg(trunk.id), wholeLeg(branch.id)]),
      },
    ],
  };
}

export function createSharedServiceTrunk(): TransitSystem {
  const center: LngLat = [-115.176, 36.13];
  const trunk = rendererWay('shared-trunk', [
    [-115.181, 36.13],
    [-115.176, 36.13],
  ]);
  const north = rendererWay('shared-north', [
    [-115.176, 36.13],
    [-115.1715, 36.133],
  ]);
  const south = rendererWay('shared-south', [
    [-115.176, 36.13],
    [-115.1715, 36.127],
  ]);
  const ways = [trunk, north, south];
  return rendererSystem({
    id: 'shared-service-trunk',
    name: 'Shared service trunk',
    viewport: { center, zoom: 16 },
    ways,
    nodes: sharedEndpointNodes('shared-service-trunk', ways),
    services: [
      branchService(trunk, north, {
        id: 'shared-red',
        name: 'Red',
        color: LINE_COLORS[0],
      }),
      branchService(trunk, south, {
        id: 'shared-blue',
        name: 'Blue',
        color: LINE_COLORS[1],
      }),
      singleWayService('shared-green', 'Green', LINE_COLORS[2], trunk.id),
    ],
  });
}

export function createComplexDiagram(): TransitSystem {
  const system = createPortMason();
  const extraWays = system.ways.filter((way) => way.typeId === 'road').slice(5, 7);
  return {
    ...system,
    id: 'complex-diagram',
    name: 'Complex diagram',
    services: [
      ...system.services,
      singleWayService('diagram-green', 'Green', LINE_COLORS[2], extraWays[0].id),
      singleWayService('diagram-purple', 'Purple', LINE_COLORS[3], extraWays[1].id),
    ],
  };
}
