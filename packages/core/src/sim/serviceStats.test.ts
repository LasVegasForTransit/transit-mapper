// One derivation of a line's stop list, shared by the Service inspector's
// "calls at" sequence and the dwells the simulation holds for. They used to be
// two implementations and disagreed about how much of a way a line covers.

import { describe, expect, it } from 'vitest';
import { pathLengthMeters, patternPath, stretchLeg, oneSection, patternLegs } from '../model/geo';
import { aPattern, aRoad, aStation } from '../testing/fixtures';
import { patternStats, patternStops } from './serviceStats';

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
