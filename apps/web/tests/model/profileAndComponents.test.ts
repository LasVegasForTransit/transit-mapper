// Converted from apps/web/tests/verify.test.ts lines 6494-7010 (8 sections).
// Split from profileMigrationsAndComponents.test.ts to stay under the
// max-lines cap; this half covers profile ops, carriageway
// separation/combination, the ECS-shaped component registry, driving side,
// and offsetPolyline. Migration coverage lives in systemMigrations.test.ts.
import { describe, expect, it } from 'vitest';
import {
  buildProfile,
  combineProfiles,
  defaultProfileFor,
  directionalLanes,
  flipProfile,
  isOneWay,
  laneCapacity,
  makeOneWay,
  makeTwoWay,
  profileWidthM,
  separateProfiles,
  travelLanes,
  withLaneCount,
} from '@transitmapper/core/model/profile';
import { PROFILE_PRESETS } from '@transitmapper/core/model/catalog';
import {
  armRefKey,
  getComponent,
  laneRefKey,
  withComponent,
  withoutComponent,
} from '@transitmapper/core/model/components';
import { offsetPolyline } from '@transitmapper/core/model/geo';
import type { CrossSection, LngLat } from '@transitmapper/core/model/system';
import { mustFind } from '../support/required.test';

describe('profile ops', () => {
  const road = defaultProfileFor('road', 4);

  it('defaultProfileFor(road, 4) carries 4 counted lanes', () => {
    expect(laneCapacity(road)).toBe(4);
  });

  it('default 4-lane road splits 2 backward / 2 forward', () => {
    expect(
      travelLanes(road).filter((l) => l.direction === 'forward' && l.kindId === 'drive').length,
    ).toBe(2);
  });

  it('lane ids are unique within a profile', () => {
    expect(new Set(road.lanes.map((l) => l.id)).size).toBe(road.lanes.length);
  });

  it('profile width sums lane widths', () => {
    expect(
      Math.abs(profileWidthM(road) - road.lanes.reduce((s, l) => s + l.widthM, 0)),
    ).toBeLessThan(1e-9);
  });

  it('odd capacity puts the extra lane forward', () => {
    const odd = defaultProfileFor('road', 5);
    expect(odd.lanes.filter((l) => l.kindId === 'drive' && l.direction === 'forward').length).toBe(
      3,
    );
  });

  it('capacity 1 becomes one bidirectional lane', () => {
    const single = defaultProfileFor('road', 1);
    expect(
      travelLanes(single)
        .filter((l) => l.kindId === 'drive')
        .every((l) => l.direction === 'both'),
    ).toBe(true);
  });

  it('flipProfile reverses lane order', () => {
    const flipped = flipProfile(road);
    expect(flipped.lanes[0].id).toBe(road.lanes[road.lanes.length - 1].id);
  });

  it('flipProfile swaps directions', () => {
    const flipped = flipProfile(road);
    expect(
      flipped.lanes.every((l) => {
        const orig = mustFind(
          road.lanes.find((o) => o.id === l.id),
          'lane',
        );
        return orig.direction === 'forward'
          ? l.direction === 'backward'
          : orig.direction === 'backward'
            ? l.direction === 'forward'
            : l.direction === orig.direction;
      }),
    ).toBe(true);
  });

  it('flipProfile twice is identity', () => {
    const flipped = flipProfile(road);
    expect(flipProfile(flipped)).toEqual(road);
  });

  it('makeOneWay makes every travel lane forward', () => {
    const oneWay = makeOneWay(road, 'forward');
    expect(isOneWay(oneWay)).toBe(true);
  });

  it('makeOneWay leaves separators/edges alone', () => {
    const oneWay = makeOneWay(road, 'forward');
    expect(
      oneWay.lanes.filter((l) => l.kindId === 'sidewalk').every((l) => l.direction === 'both'),
    ).toBe(true);
  });

  it('makeTwoWay restores a directional split', () => {
    const oneWay = makeOneWay(road, 'forward');
    const twoWay = makeTwoWay(oneWay);
    expect(isOneWay(twoWay)).toBe(false);
    expect(travelLanes(twoWay).some((l) => l.direction === 'backward')).toBe(true);
  });

  it('withLaneCount grows to the target', () => {
    const widened = withLaneCount(road, 'road', 6);
    expect(laneCapacity(widened)).toBe(6);
  });

  it('withLaneCount keeps the directional split balanced', () => {
    const widened = withLaneCount(road, 'road', 6);
    const fwd6 = widened.lanes.filter(
      (l) => l.kindId === 'drive' && l.direction === 'forward',
    ).length;
    expect(fwd6).toBe(3);
  });

  it('withLaneCount shrinks to the target', () => {
    const widened = withLaneCount(road, 'road', 6);
    const narrowed = withLaneCount(widened, 'road', 2);
    expect(laneCapacity(narrowed)).toBe(2);
  });

  it('withLaneCount(1) floors at one lane', () => {
    expect(laneCapacity(withLaneCount(road, 'road', 0))).toBe(1);
  });

  it('widening a one-way road stays one-way', () => {
    const oneWayWidened = withLaneCount(
      makeOneWay(defaultProfileFor('road', 2), 'forward'),
      'road',
      3,
    );
    expect(isOneWay(oneWayWidened)).toBe(true);
    expect(laneCapacity(oneWayWidened)).toBe(3);
  });
});

describe('carriageway separation / combination (profile level)', () => {
  const boulevard = buildProfile(PROFILE_PRESETS.roadBoulevard.lanes);
  const sep = mustFind(separateProfiles(boulevard), 'separateProfiles(boulevard)');

  it('separateProfiles splits a divided boulevard', () => {
    expect(sep).not.toBeNull();
  });

  it('forward carriageway is one-way forward', () => {
    expect(isOneWay(sep.forward)).toBe(true);
    expect(directionalLanes(sep.forward).every((l) => l.direction === 'forward')).toBe(true);
  });

  it('backward carriageway is one-way backward', () => {
    expect(directionalLanes(sep.backward).every((l) => l.direction === 'backward')).toBe(true);
  });

  it('the median itself is dropped (the physical gap replaces it)', () => {
    expect([...sep.forward.lanes, ...sep.backward.lanes].every((l) => l.kindId !== 'median')).toBe(
      true,
    );
  });

  it("each carriageway keeps its own side's bike lane", () => {
    expect(sep.forward.lanes.some((l) => l.kindId === 'bike')).toBe(true);
    expect(sep.backward.lanes.some((l) => l.kindId === 'bike')).toBe(true);
  });

  it('separateProfiles refuses a one-way profile', () => {
    expect(separateProfiles(makeOneWay(boulevard, 'forward'))).toBeNull();
  });

  it('combineProfiles restores two-way travel', () => {
    const recombined = combineProfiles(sep.backward, sep.forward);
    expect(isOneWay(recombined)).toBe(false);
    expect(travelLanes(recombined).some((l) => l.direction === 'forward')).toBe(true);
    expect(travelLanes(recombined).some((l) => l.direction === 'backward')).toBe(true);
  });

  it('combineProfiles inserts a median between the halves', () => {
    const recombined = combineProfiles(sep.backward, sep.forward);
    expect(recombined.lanes.some((l) => l.kindId === 'median')).toBe(true);
  });

  it('combineProfiles accepts a captured width/kind instead of the catalog default', () => {
    const recombinedKind = combineProfiles(sep.backward, sep.forward, 5, 'railReservation');
    expect(recombinedKind.lanes.some((l) => l.kindId === 'railReservation' && l.widthM === 5)).toBe(
      true,
    );
  });
});

describe('ECS-shaped component registry (model/components.ts)', () => {
  const empty: Record<string, { n: number }> = {};
  const withA = withComponent(empty, 'a', { n: 1 });

  it('withComponent adds without mutating the original map', () => {
    expect(empty.a).toBeUndefined();
    expect(withA.a.n).toBe(1);
  });

  it('getComponent reads a present key', () => {
    expect(getComponent(withA, 'a')?.n).toBe(1);
  });

  it('getComponent reads an absent key as undefined', () => {
    expect(getComponent(withA, 'b')).toBeUndefined();
  });

  it('withoutComponent removes only the given key', () => {
    const withB = withComponent(withA, 'b', { n: 2 });
    const withoutA = withoutComponent(withB, 'a');
    expect(withoutA.a).toBeUndefined();
    expect(withoutA.b.n).toBe(2);
  });

  it('withoutComponent on an absent key is a no-op (same reference)', () => {
    const withB = withComponent(withA, 'b', { n: 2 });
    expect(withoutComponent(withB, 'z')).toBe(withB);
  });

  it('laneRefKey/armRefKey format lane and arm references', () => {
    expect(laneRefKey('w1', 'l1')).toBe('w1:l1');
    expect(armRefKey('w1', 'start')).toBe('w1:start');
  });
});

// driving side (model/profile.ts) — target-way/kind identity, never an angle
// bucket, is what makes turn restrictions robust; drivingSide is the one
// place actual left/right geometry matters, and it's isolated to these three
// functions.
describe('driving side (model/profile.ts)', () => {
  // separateProfiles: which array-half becomes which carriageway flips.
  const customProfile: CrossSection = {
    lanes: [
      { id: 's1', kindId: 'shoulder', widthM: 2, direction: 'none' },
      { id: 'd1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'd2', kindId: 'drive', widthM: 3.3, direction: 'forward' },
      { id: 'p1', kindId: 'parking', widthM: 2, direction: 'none' },
    ],
  };
  const rightSep = mustFind(separateProfiles(customProfile, 'right'), 'separateProfiles(right)');
  const leftSep = mustFind(separateProfiles(customProfile, 'left'), 'separateProfiles(left)');

  it('separateProfiles(right): backward carriageway keeps the array-left half', () => {
    expect(rightSep.backward.lanes.some((l) => l.kindId === 'shoulder')).toBe(true);
    expect(rightSep.forward.lanes.some((l) => l.kindId === 'parking')).toBe(true);
  });

  it('separateProfiles(left): mirrored — forward carriageway keeps the array-left half', () => {
    expect(leftSep.forward.lanes.some((l) => l.kindId === 'shoulder')).toBe(true);
    expect(leftSep.backward.lanes.some((l) => l.kindId === 'parking')).toBe(true);
  });

  // makeTwoWay: which half gets which direction flips.
  const oneWay4 = makeOneWay(defaultProfileFor('road', 4), 'forward');
  const rightTwoWay = makeTwoWay(oneWay4, 'right');
  const leftTwoWay = makeTwoWay(oneWay4, 'left');
  const rightDirs = directionalLanes(rightTwoWay).map((l) => l.direction);
  const leftDirs = directionalLanes(leftTwoWay).map((l) => l.direction);

  it('makeTwoWay(right) puts backward lanes first (array-left)', () => {
    expect(rightDirs[0]).toBe('backward');
    expect(rightDirs[rightDirs.length - 1]).toBe('forward');
  });

  it('makeTwoWay(left) mirrors: forward lanes first', () => {
    expect(leftDirs[0]).toBe('forward');
    expect(leftDirs[leftDirs.length - 1]).toBe('backward');
  });

  it('makeTwoWay driving side changes direction assignment only, not lane count', () => {
    expect(rightTwoWay.lanes.length).toBe(leftTwoWay.lanes.length);
  });

  it('makeTwoWay defaults to right-hand traffic (matches pre-existing behavior)', () => {
    expect(makeTwoWay(oneWay4).lanes).toEqual(rightTwoWay.lanes);
  });

  // withLaneCount: which side a new lane inserts on flips.
  const twoLane: CrossSection = {
    lanes: [
      { id: 'b1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'f1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
    ],
  };
  const grownRight = withLaneCount(twoLane, 'road', 3, 'right');
  const grownLeft = withLaneCount(twoLane, 'road', 3, 'left');

  it('withLaneCount(right) inserts the new forward lane at the end', () => {
    expect(grownRight.lanes[0].id).toBe('b1');
    expect(grownRight.lanes[grownRight.lanes.length - 1].direction).toBe('forward');
    expect(grownRight.lanes[grownRight.lanes.length - 1].id).not.toBe('f1');
  });

  it('withLaneCount(left) mirrors: inserts the new forward lane at the front', () => {
    expect(grownLeft.lanes[0].direction).toBe('forward');
    expect(grownLeft.lanes[0].id).not.toBe('f1');
    expect(grownLeft.lanes.some((l) => l.id === 'b1')).toBe(true);
  });
});

describe('offsetPolyline (the carriageway/lane offset primitive)', () => {
  const line: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]; // due east

  it('offsetPolyline(+) shifts right of travel (south when heading east)', () => {
    const right = offsetPolyline(line, 10);
    const dyMeters = (right[0][1] - line[0][1]) * 111320;
    expect(dyMeters).toBeLessThan(-9);
    expect(dyMeters).toBeGreaterThan(-11);
  });

  it('offsetPolyline(−) shifts left of travel', () => {
    const left = offsetPolyline(line, -10);
    expect((left[0][1] - line[0][1]) * 111320).toBeGreaterThan(9);
  });

  it('offsetPolyline keeps the vertex count', () => {
    const bent: LngLat[] = [
      [-115.2, 36.1],
      [-115.15, 36.1],
      [-115.15, 36.15],
    ];
    const bentOff = offsetPolyline(bent, 5);
    expect(bentOff.length).toBe(bent.length);
  });

  // A wide offset toward the inside of a TIGHT curve (offset > radius) used to
  // fold back on itself — the "carriageway spike" where a wide road follows a
  // freeway ramp / tight junction. The de-loop drops the collapsed run so the
  // inner edge pinches straight across the corner instead of looping.
  it('offsetPolyline de-loops a wide offset on a tight curve (no inner-corner spike)', () => {
    const R = 10 / 111320; // ~10 m radius quarter turn
    const tightCurve: LngLat[] = [];
    for (let a = 0; a <= 90; a += 9) {
      const r = (a * Math.PI) / 180;
      tightCurve.push([-115.15 + R * Math.cos(r), 36.13 + R * Math.sin(r)]);
    }
    const innerEdge = offsetPolyline(tightCurve, -12); // inward by MORE than the radius
    let reversals = 0;
    for (let i = 2; i < innerEdge.length; i++) {
      const px = innerEdge[i - 1][0] - innerEdge[i - 2][0],
        py = innerEdge[i - 1][1] - innerEdge[i - 2][1];
      const dx = innerEdge[i][0] - innerEdge[i - 1][0],
        dy = innerEdge[i][1] - innerEdge[i - 1][1];
      const mag = Math.hypot(px, py) * Math.hypot(dx, dy);
      if (mag > 0 && (px * dx + py * dy) / mag < -0.3) reversals++;
    }
    expect(reversals).toBe(0);
  });
});
