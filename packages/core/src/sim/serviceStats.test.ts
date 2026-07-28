// One derivation of a line's stop list, shared by the Service inspector's
// "calls at" sequence and the dwells the simulation holds for. They used to be
// two implementations and disagreed about how much of a way a line covers.

import { describe, expect, it } from 'vitest';
import {
  pathLengthMeters,
  patternPath,
  patternRunPath,
  stretchLeg,
  oneSection,
  patternLegs,
  wholeLeg,
} from '../model/geo';
import { aPattern, aRoad, aStation } from '../testing/fixtures';
import { dwellStopsForPattern, patternStats, patternStops } from './serviceStats';
import type { Pattern } from '../model/system';

const road = aRoad('w', [
  [-115.2, 36.1],
  [-115.1, 36.1],
]);
const ways = [road];
const wholeStreet = aPattern('p', ways, ['w']);

const stopsOf = (pattern = wholeStreet, stations = allStations) => {
  const path = patternPath(ways, pattern);
  return patternStops(stations, pattern, path, pathLengthMeters(path));
};

const allStations = [
  aStation('east', [-115.12, 36.1], { wayId: 'w', t: 0.8 }),
  aStation('west', [-115.18, 36.1], { wayId: 'w', t: 0.2 }),
  aStation('middle', [-115.15, 36.1], { wayId: 'w', t: 0.5 }),
];

describe('a line running a whole street', () => {
  it('calls at its stations in the order a rider reaches them', () => {
    expect(stopsOf().map((s) => s.station.id)).toEqual(['west', 'middle', 'east']);
  });

  it('measures each stop by how far into the run it is', () => {
    const distances = stopsOf().map((s) => s.distMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('gives a station its own dwell, falling back to the default', () => {
    const held = aStation('held', [-115.15, 36.1], { wayId: 'w', t: 0.5 }, { dwellSeconds: 90 });
    expect(stopsOf(wholeStreet, [held])[0].dwellMs).toBe(90_000);
    expect(stopsOf()[0].dwellMs).toBe(20_000);
  });
});

describe('a line terminating mid-block', () => {
  // Half the street. `east` sits past the terminus, so a rider never reaches
  // it — but the inspector's own copy of this filtered on way id alone and
  // listed it anyway, while the vehicle correctly drove past.
  const halfStreet = aPattern('p2', ways, ['w']);
  halfStreet.sections = oneSection([stretchLeg(patternLegs(halfStreet)[0], 0, 0.6)]);

  it('does not call at a station past where it stops', () => {
    expect(stopsOf(halfStreet).map((s) => s.station.id)).toEqual(['west', 'middle']);
  });

  it('reports a shorter round trip than the whole street', () => {
    const half = patternStats(ways, allStations, halfStreet, 15)!;
    const whole = patternStats(ways, allStations, wholeStreet, 15)!;
    expect(half.meters).toBeLessThan(whole.meters);
    expect(half.stops.map((s) => s.station.id)).toEqual(['west', 'middle']);
  });
});

describe('what a line amounts to', () => {
  it('reports a round trip of exactly twice the one-way time', () => {
    const stats = patternStats(ways, allStations, wholeStreet, 15)!;
    expect(stats.roundTripMs).toBe(2 * stats.oneWayMs);
  });

  it('counts dwell as time standing still, on top of travel', () => {
    const stats = patternStats(ways, allStations, wholeStreet, 15)!;
    const moving = patternStats(ways, [], wholeStreet, 15)!;
    expect(stats.dwellMs).toBe(60_000);
    expect(stats.oneWayMs).toBe(moving.oneWayMs + stats.dwellMs);
  });

  it('hands back the path it measured, for callers placing positions on it', () => {
    const stats = patternStats(ways, allStations, wholeStreet, 15)!;
    expect(stats.cumLengths[stats.cumLengths.length - 1]).toBeCloseTo(stats.meters, 6);
    expect(pathLengthMeters(stats.path)).toBeCloseTo(stats.meters, 6);
  });

  it('claims nothing about a line whose ways resolve to no path', () => {
    expect(patternStats([], allStations, wholeStreet, 15)).toBeNull();
  });
});

describe('a platform both directions of a couplet use', () => {
  // A transit centre, or an island platform: ONE station record riding BOTH
  // ways. That is what `Station.anchors` is for — a single anchor could only
  // name one of them, and every line on the other drove past a stop it plainly
  // calls at.
  const A = aRoad('outward', [
    [-115.2, 36.1],
    [-115.2, 36.12],
  ]);
  const B = aRoad('return', [
    [-115.199, 36.12],
    [-115.199, 36.1],
  ]);
  const couplet: Pattern = {
    id: 'cp',
    sections: [{ kind: 'split', outbound: [wholeLeg('outward')], inbound: [wholeLeg('return')] }],
  };
  const shared = aStation(
    'centre',
    [-115.2, 36.11],
    { wayId: 'outward', t: 0.5 },
    {
      anchors: [
        { wayId: 'outward', t: 0.5 },
        { wayId: 'return', t: 0.5 },
      ],
    },
  );
  const ways = [A, B];

  const idsOn = (run: 'outbound' | 'inbound') =>
    patternStops(
      [shared],
      couplet,
      patternRunPath(ways, couplet, run),
      pathLengthMeters(patternRunPath(ways, couplet, run)),
      run,
    ).map((s) => s.station.id);

  it('is called at by both directions', () => {
    expect(idsOn('outbound')).toEqual(['centre']);
    expect(idsOn('inbound')).toEqual(['centre']);
  });

  it('is not counted twice in either direction', () => {
    expect(idsOn('outbound').length).toBe(1);
    expect(idsOn('inbound').length).toBe(1);
  });
});

describe('a stop anchored to only one half of a couplet', () => {
  // No proximity guessing: a station records the ways it rides, and a
  // direction that does not ride one of them drives past. This used to be
  // inferred from how close the two streets happened to be.
  const A = aRoad('outward', [
    [-115.2, 36.1],
    [-115.2, 36.12],
  ]);
  const B = aRoad('return', [
    [-115.199, 36.12],
    [-115.199, 36.1],
  ]);
  const couplet: Pattern = {
    id: 'one-sided',
    sections: [{ kind: 'split', outbound: [wholeLeg('outward')], inbound: [wholeLeg('return')] }],
  };
  const onReturnOnly = aStation('east', [-115.199, 36.11], { wayId: 'return', t: 0.5 });
  const ways = [A, B];

  it('is called at by the direction that rides its way', () => {
    const path = patternRunPath(ways, couplet, 'inbound');
    expect(
      patternStops([onReturnOnly], couplet, path, pathLengthMeters(path), 'inbound').map(
        (s) => s.station.id,
      ),
    ).toEqual(['east']);
  });

  it('is not claimed by the direction that does not', () => {
    const path = patternRunPath(ways, couplet, 'outbound');
    expect(
      patternStops([onReturnOnly], couplet, path, pathLengthMeters(path), 'outbound').map(
        (s) => s.station.id,
      ),
    ).toEqual([]);
  });
});

describe('a stop served in one direction only', () => {
  // The case sections alone cannot express: ONE street, ridden both ways, with
  // a stop the return trip runs past without calling at. A couplet gets this
  // for free because its two directions ride different ways; this does not.
  const street = aRoad('street', [
    [-115.2, 36.1],
    [-115.2, 36.14],
  ]);
  const stops = [
    aStation('south', [-115.2, 36.11], { wayId: 'street', t: 0.25 }),
    aStation('north', [-115.2, 36.13], { wayId: 'street', t: 0.75 }),
  ];
  const base: Pattern = { id: 'p', sections: oneSection([wholeLeg('street')]) };
  const skippingNorthOnTheWayBack: Pattern = {
    ...base,
    skippedStops: { inbound: ['north'] },
  };

  const idsOn = (pattern: Pattern, run: 'outbound' | 'inbound') => {
    const path = patternRunPath([street], pattern, run);
    return patternStops(stops, pattern, path, pathLengthMeters(path), run).map((s) => s.station.id);
  };

  it('calls at both stops in both directions when nothing is skipped', () => {
    expect(idsOn(base, 'outbound').sort()).toEqual(['north', 'south']);
    expect(idsOn(base, 'inbound').sort()).toEqual(['north', 'south']);
  });

  it('still calls at the skipped stop in the direction that was not skipped', () => {
    expect(idsOn(skippingNorthOnTheWayBack, 'outbound').sort()).toEqual(['north', 'south']);
  });

  it('does not call at it in the direction it was skipped in', () => {
    expect(idsOn(skippingNorthOnTheWayBack, 'inbound')).toEqual(['south']);
  });

  it('does not slow the vehicle down where it no longer stops', () => {
    // The inspector's list and the dwells the simulation holds for are one
    // derivation, so a skip has to reach the clock as well as the panel.
    const path = patternRunPath([street], skippingNorthOnTheWayBack, 'inbound');
    const dwells = dwellStopsForPattern(
      stops,
      skippingNorthOnTheWayBack,
      path,
      pathLengthMeters(path),
      'inbound',
    );
    expect(dwells).toHaveLength(1);
  });
});
