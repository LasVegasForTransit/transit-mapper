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
} from '../../src/model/geo';
import { aPattern, aRoad, aStop } from '../support/fixtures.test';
import {
  dwellStopsForPattern,
  effectiveVehicleKind,
  patternStats,
  patternStops,
} from '../../src/sim/serviceStats';
import type { VehicleMotionProfile } from '../../src/sim/timetable';
import type { Pattern, Service, VehicleKind } from '../../src/model/system';

const profile: VehicleMotionProfile = { speedMps: 15, accelMps2: 2, decelMps2: 2 };

const road = aRoad('w', [
  [-115.2, 36.1],
  [-115.1, 36.1],
]);
const ways = [road];
const wholeStreet = aPattern('p', ways, ['w']);

const stopsOf = (pattern = wholeStreet, stops = allStops) => {
  const path = patternPath(ways, pattern);
  return patternStops(stops, pattern, path, pathLengthMeters(path));
};

const allStops = [
  aStop('east', [-115.12, 36.1], { wayId: 'w', t: 0.8 }),
  aStop('west', [-115.18, 36.1], { wayId: 'w', t: 0.2 }),
  aStop('middle', [-115.15, 36.1], { wayId: 'w', t: 0.5 }),
];

function requiredStats(pattern: Pattern, stops = allStops) {
  const stats = patternStats(ways, stops, pattern, profile);
  if (!stats) throw new Error('Expected the fixture pattern to resolve');
  return stats;
}

describe('vehicle kind resolution', () => {
  it('ignores an assigned kind whose mode does not match the service', () => {
    const service: Service = {
      id: 'service',
      modeId: 'bus',
      vehicleKindId: 'rail-kind',
      path: { id: 'service', sections: [] },
    };
    const kind: VehicleKind = {
      id: 'rail-kind',
      modeId: 'lightRail',
      label: 'Rail vehicle',
      widthM: 9,
      lengthM: 99,
    };

    expect(effectiveVehicleKind([kind], service)).toEqual(effectiveVehicleKind([], service));
  });
});

describe('a line running a whole street', () => {
  it('calls at its stops in the order a rider reaches them', () => {
    expect(stopsOf().map((s) => s.stop.id)).toEqual(['west', 'middle', 'east']);
  });

  it('measures each stop by how far into the run it is', () => {
    const distances = stopsOf().map((s) => s.distMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('gives a stop its own dwell, falling back to the default', () => {
    const held = aStop('held', [-115.15, 36.1], { wayId: 'w', t: 0.5 }, { dwellSeconds: 90 });
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

  it('does not call at a stop past where it stops', () => {
    expect(stopsOf(halfStreet).map((s) => s.stop.id)).toEqual(['west', 'middle']);
  });

  it('reports a shorter round trip than the whole street', () => {
    const half = requiredStats(halfStreet);
    const whole = requiredStats(wholeStreet);
    expect(half.meters).toBeLessThan(whole.meters);
    expect(half.stops.map((s) => s.stop.id)).toEqual(['west', 'middle']);
  });
});

describe('what a line amounts to', () => {
  it('reports a round trip of exactly twice the one-way time', () => {
    const stats = requiredStats(wholeStreet);
    expect(stats.roundTripMs).toBe(2 * stats.oneWayMs);
  });

  it('counts dwell as time standing still, on top of travel — and each stop costs more than that alone', () => {
    const stats = requiredStats(wholeStreet);
    const moving = requiredStats(wholeStreet, []);
    expect(stats.dwellMs).toBe(60_000);
    // Splitting one leg into several doesn't just add the dwell: each stop
    // also makes the vehicle brake to rest and accelerate again, which a
    // single unbroken leg never has to do.
    expect(stats.oneWayMs).toBeGreaterThan(moving.oneWayMs + stats.dwellMs);
  });

  it('hands back the path it measured, for callers placing positions on it', () => {
    const stats = requiredStats(wholeStreet);
    expect(stats.cumLengths[stats.cumLengths.length - 1]).toBeCloseTo(stats.meters, 6);
    expect(pathLengthMeters(stats.path)).toBeCloseTo(stats.meters, 6);
  });

  it('claims nothing about a line whose ways resolve to no path', () => {
    expect(patternStats([], allStops, wholeStreet, profile)).toBeNull();
  });
});

describe('a platform both directions of a couplet use', () => {
  // A transit centre, or an island platform: ONE stop record riding BOTH
  // ways. That is what `Stop.anchors` is for — a single anchor could only
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
  const shared = aStop(
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
    ).map((s) => s.stop.id);

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
  // No proximity guessing: a stop records the ways it rides, and a
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
  const onReturnOnly = aStop('east', [-115.199, 36.11], { wayId: 'return', t: 0.5 });
  const ways = [A, B];

  it('is called at by the direction that rides its way', () => {
    const path = patternRunPath(ways, couplet, 'inbound');
    expect(
      patternStops([onReturnOnly], couplet, path, pathLengthMeters(path), 'inbound').map(
        (s) => s.stop.id,
      ),
    ).toEqual(['east']);
  });

  it('is not claimed by the direction that does not', () => {
    const path = patternRunPath(ways, couplet, 'outbound');
    expect(
      patternStops([onReturnOnly], couplet, path, pathLengthMeters(path), 'outbound').map(
        (s) => s.stop.id,
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
    aStop('south', [-115.2, 36.11], { wayId: 'street', t: 0.25 }),
    aStop('north', [-115.2, 36.13], { wayId: 'street', t: 0.75 }),
  ];
  const base: Pattern = { id: 'p', sections: oneSection([wholeLeg('street')]) };
  const skippingNorthOnTheWayBack: Pattern = {
    ...base,
    skippedStops: { inbound: ['north'] },
  };

  const idsOn = (pattern: Pattern, run: 'outbound' | 'inbound') => {
    const path = patternRunPath([street], pattern, run);
    return patternStops(stops, pattern, path, pathLengthMeters(path), run).map((s) => s.stop.id);
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
