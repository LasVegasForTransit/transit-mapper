import { LINE_COLORS } from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { Service, TransitSystem, Way } from '@transitmapper/core/model/system';
import { rendererSystem, rendererWay, sharedEndpointNodes } from './renderer-fixture-builders';

const WEST_X = [-122.49, -122.478, -122.466] as const;
const EAST_X = [-122.446, -122.434, -122.422] as const;
const ROWS = [37.738, 37.748, 37.758, 37.768] as const;

/** A real multi-arm junction used as the fixed screen-space focal point.
 * Bounding-box centers fall in the harbor, which makes high-zoom evidence
 * prove only that the camera can render an empty background. */
export const PORT_MASON_RENDERER_CENTER: [number, number] = [EAST_X[0], ROWS[2]];

function portMasonGrid(bank: 'west' | 'east', xs: readonly number[]): Way[] {
  const roads: Way[] = [];
  for (let row = 0; row < ROWS.length; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      const id = `port-mason-${bank}-horizontal-${row}-${column}`;
      const bend = (row + column) % 2 === 0 ? 0.00035 : -0.00035;
      roads.push(
        rendererWay(
          id,
          [
            [xs[column], ROWS[row]],
            [(xs[column] + xs[column + 1]) / 2, ROWS[row] + bend],
            [xs[column + 1], ROWS[row]],
          ],
          { geometry: 'freeform' },
        ),
      );
    }
  }
  for (let column = 0; column < xs.length; column++) {
    for (let row = 0; row < ROWS.length - 1; row++) {
      const id = `port-mason-${bank}-vertical-${column}-${row}`;
      roads.push(
        rendererWay(
          id,
          [
            [xs[column], ROWS[row]],
            [xs[column] + (row % 2 === 0 ? 0.0003 : -0.0003), (ROWS[row] + ROWS[row + 1]) / 2],
            [xs[column], ROWS[row + 1]],
          ],
          { geometry: 'freeform' },
        ),
      );
    }
  }
  return roads;
}

interface PortMasonServiceOptions {
  bridge: Way;
  railWays: readonly Way[];
}

function portMasonServices({ bridge, railWays }: PortMasonServiceOptions): Service[] {
  const crosstownWayIds = [
    'port-mason-west-horizontal-2-0',
    'port-mason-west-horizontal-2-1',
    bridge.id,
    'port-mason-east-horizontal-2-0',
    'port-mason-east-horizontal-2-1',
  ];
  return [
    {
      id: 'port-mason-crosstown',
      name: 'Crosstown',
      modeId: 'bus',
      color: LINE_COLORS[0],
      frequencyMinutes: 10,
      patterns: [
        {
          id: 'port-mason-crosstown-pattern',
          sections: oneSection(crosstownWayIds.map((wayId) => wholeLeg(wayId))),
        },
      ],
    },
    {
      id: 'port-mason-harbor-line',
      name: 'Harbor Line',
      modeId: 'lightRail',
      color: LINE_COLORS[1],
      frequencyMinutes: 12,
      patterns: [
        {
          id: 'port-mason-harbor-pattern',
          sections: oneSection(railWays.map((way) => wholeLeg(way.id))),
        },
      ],
    },
  ];
}

function portMasonRail(): Way[] {
  return [
    rendererWay(
      'port-mason-rail-north',
      [
        [-122.444, 37.777],
        [-122.444, 37.762],
      ],
      { typeId: 'lightRail', grade: 'elevated' },
    ),
    rendererWay(
      'port-mason-rail-link',
      [
        [-122.444, 37.762],
        [-122.434, ROWS[2]],
      ],
      { typeId: 'lightRail', geometry: 'curved', grade: 'elevated' },
    ),
    rendererWay(
      'port-mason-rail-south',
      [
        [-122.434, ROWS[2]],
        [-122.444, 37.731],
      ],
      { typeId: 'lightRail', grade: 'elevated' },
    ),
  ];
}

export function createPortMason(): TransitSystem {
  const roads = [...portMasonGrid('west', WEST_X), ...portMasonGrid('east', EAST_X)];
  const bridge = rendererWay('port-mason-harbor-bridge', [
    [WEST_X[2], ROWS[2]],
    [EAST_X[0], ROWS[2]],
  ]);
  roads.push(bridge);
  const railWays = portMasonRail();
  return rendererSystem({
    id: 'renderer-port-mason',
    name: 'Port Mason renderer reference',
    viewport: { center: [...PORT_MASON_RENDERER_CENTER], zoom: 12.2 },
    ways: [...roads, ...railWays],
    nodes: sharedEndpointNodes('port-mason', roads),
    services: portMasonServices({ bridge, railWays }),
  });
}
