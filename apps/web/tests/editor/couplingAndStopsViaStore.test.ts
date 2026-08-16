// Split out of lineEditingViaStore.test.ts: the two files together cover
// source lines 11658-12181 of the old verify.test.ts (8 sections). Kept as
// one file, this content pushed the effective line count to 589 against the
// repository's 400-line cap (`max-lines`, `packages/config-eslint`), so the
// four sections here — all about a service's response to a network-level
// edit rather than a direct pattern trim/split — moved to their own file.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  patternHasCouplet,
  patternHasSplit,
  patternRunLegs,
  patternRunPath,
  pathLengthMeters,
} from '@transitmapper/core/model/geo';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { validateSystem } from '@transitmapper/core/model/validate';
import { patternStops } from '@transitmapper/core/sim/serviceStats';
import type { LngLat, Pattern, Service, TransitSystem } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

/** A non-null assertion by another name — `!` is banned by lint, this isn't. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value, got null/undefined');
  return value;
}

// A bus running out along a street, round a block at the far end, and back the
// way it came. Not a couplet: the line is shared end to end and the loop is
// ridden ONCE per cycle. Drawing one used to be refused outright.
describe('a loop at the terminus', () => {
  let store: ReturnType<typeof createEditorStore>;
  let tSvc: string;
  let looped: boolean;
  let lp: Pattern;
  let outWays: string[];
  let backWays: string[];

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
    const P = (lng: number, lat: number): LngLat => [lng, lat];
    const road = (id: string, pts: LngLat[]) => ({
      id,
      typeId: 'road',
      points: pts,
      geometry: 'straight' as const,
      grade: 'atGrade' as const,
    });
    const S = P(-115.2, 36.1);
    const N = P(-115.2, 36.13);
    const NE = P(-115.1988, 36.13);
    const SE = P(-115.1988, 36.128);
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          road('spine', [S, N]),
          road('top', [N, NE]),
          road('side', [NE, SE]),
          road('back', [SE, N]),
        ],
        services: [],
        stations: [],
      }),
    );
    tSvc = must(store.getState().addServiceToWay('spine'));
    const tPat = must(store.getState().system.services.find((sv) => sv.id === tSvc)).patterns[0];
    // The loop starts and ends at the spine's far terminus.
    looped = store.getState().attachReturnPath(tSvc, tPat.id, [
      { wayId: 'top', fromPoint: 0, toPoint: 1 },
      { wayId: 'side', fromPoint: 0, toPoint: 1 },
      { wayId: 'back', fromPoint: 0, toPoint: 1 },
    ]);

    lp = must(store.getState().system.services.find((sv) => sv.id === tSvc)).patterns[0];
    outWays = patternRunLegs(lp, 'outbound').map((r) => r.leg.wayId);
    backWays = patternRunLegs(lp, 'inbound').map((r) => r.leg.wayId);
  });

  it('a loop drawn at the terminus is accepted', () => {
    expect(looped).toBe(true);
  });

  it('it is a turnaround, not a couplet', () => {
    expect(lp.sections.some((x) => x.kind === 'turnaround')).toBe(true);
    expect(patternHasCouplet(lp)).toBe(false);
  });

  it('the outward trip runs the spine and then the loop', () => {
    expect(outWays).toContain('spine');
    expect(outWays).toContain('side');
  });

  it('the return trip runs the spine and not the loop again', () => {
    expect(backWays).toContain('spine');
    expect(backWays).not.toContain('side');
  });

  it('the loop is ridden once per cycle, not twice', () => {
    const rides =
      outWays.filter((w) => w === 'side').length + backWays.filter((w) => w === 'side').length;
    expect(rides).toBe(1);
  });

  it('a turnaround survives a save and a reload', () => {
    const reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(
      must(reloaded.services.find((sv) => sv.id === tSvc)).patterns[0].sections.some(
        (x) => x.kind === 'turnaround',
      ),
    ).toBe(true);
  });
});

// A transit centre both halves of a couplet pull into is ONE station riding
// TWO ways. With a single anchor it bound to whichever was nearest when it was
// placed, and every line on the other drove past a stop it plainly calls at.
describe('a platform on more than one way', () => {
  let store: ReturnType<typeof createEditorStore>;
  let centreId: string;
  let callsAtNorth: boolean;
  let callsAtSouth: boolean;
  let reloaded: TransitSystem;
  let afterStation: TransitSystem['stations'][number] | undefined;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          {
            id: 'northbound',
            typeId: 'road',
            points: [
              [-115.2, 36.1],
              [-115.2, 36.14],
            ],
            geometry: 'straight',
            grade: 'atGrade',
          },
          {
            id: 'southbound',
            typeId: 'road',
            points: [
              [-115.199, 36.14],
              [-115.199, 36.1],
            ],
            geometry: 'straight',
            grade: 'atGrade',
          },
        ],
        services: [],
        stations: [],
      }),
    );
    centreId = must(store.getState().addStation([-115.2, 36.12], { wayId: 'northbound', t: 0.5 }));
    // The same platform is reached from the other carriageway too.
    store.getState().setSystem({
      ...store.getState().system,
      stations: store
        .getState()
        .system.stations.map((st) =>
          st.id !== centreId
            ? st
            : { ...st, anchors: [...st.anchors, { wayId: 'southbound', t: 0.5 }] },
        ),
    });
    const northSvc = must(store.getState().addServiceToWay('northbound'));
    const southSvc = must(store.getState().addServiceToWay('southbound'));

    const callsAt = (svcId: string) => {
      const sys = store.getState().system;
      const pt = must(sys.services.find((sv) => sv.id === svcId)).patterns[0];
      const path = patternRunPath(sys.ways, pt, 'outbound');
      return patternStops(sys.stations, pt, path, pathLengthMeters(path), 'outbound').some(
        (x) => x.station.id === centreId,
      );
    };
    callsAtNorth = callsAt(northSvc);
    callsAtSouth = callsAt(southSvc);

    reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));

    // Deleting one carriageway must not delete a platform the other still serves.
    store.getState().deleteWay('southbound');
    afterStation = store.getState().system.stations.find((st) => st.id === centreId);
  });

  it('a line on the first way calls at the shared platform', () => {
    expect(callsAtNorth).toBe(true);
  });

  it('a line on the second way calls at it too', () => {
    expect(callsAtSouth).toBe(true);
  });

  it('both anchors survive a save and a reload', () => {
    expect(must(reloaded.stations.find((st) => st.id === centreId)).anchors).toHaveLength(2);
  });

  it('deleting one of its ways keeps the station', () => {
    expect(afterStation).toBeDefined();
  });

  it('and drops only the anchor that named the deleted way', () => {
    const station = must(afterStation);
    expect(station.anchors).toHaveLength(1);
    expect(station.anchors[0].wayId).toBe('northbound');
  });
});

// One street ridden both ways, with a stop the return trip runs past. Nothing
// about sections can express this: the stretch is shared, so the omission has
// nowhere to live but an explicit record.
describe('skipping a stop in one direction', () => {
  let store: ReturnType<typeof createEditorStore>;
  let northId: string;
  let idsOnInboundBefore: string[];
  let idsOnInboundAfterSkip: string[];
  let idsOnOutboundAfterSkip: string[];
  let rp: Pattern;
  let dp: Pattern;
  let cleared: Pattern;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          {
            id: 'street',
            typeId: 'road',
            points: [
              [-115.2, 36.1],
              [-115.2, 36.14],
            ],
            geometry: 'straight',
            grade: 'atGrade',
          },
        ],
        services: [],
        stations: [],
      }),
    );
    const sSvc = must(store.getState().addServiceToWay('street'));
    const sPat = must(store.getState().system.services.find((sv) => sv.id === sSvc)).patterns[0];
    // Anchored explicitly: addStation places a station where it is told and does
    // not go looking for a way to bind it to, and an unanchored station is not a
    // stop on anything.
    northId = must(store.getState().addStation([-115.2, 36.13], { wayId: 'street', t: 0.75 }));
    store.getState().addStation([-115.2, 36.11], { wayId: 'street', t: 0.25 });

    const idsOn = (run: 'outbound' | 'inbound') => {
      const sys = store.getState().system;
      const pt = must(sys.services.find((sv) => sv.id === sSvc)).patterns[0];
      const path = patternRunPath(sys.ways, pt, run);
      return patternStops(sys.stations, pt, path, pathLengthMeters(path), run).map(
        (x) => x.station.id,
      );
    };

    idsOnInboundBefore = idsOn('inbound');

    store.getState().setStopSkipped(sSvc, sPat.id, 'inbound', northId, true);
    idsOnInboundAfterSkip = idsOn('inbound');
    idsOnOutboundAfterSkip = idsOn('outbound');

    // Serialization is where this vanishes silently if it is not carried.
    const reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    rp = must(reloaded.services.find((sv) => sv.id === sSvc)).patterns[0];

    // A skip names a station, and a station can be deleted after the fact.
    store.getState().deleteStation(northId);
    const afterDelete = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    dp = must(afterDelete.services.find((sv) => sv.id === sSvc)).patterns[0];

    store.getState().setStopSkipped(sSvc, sPat.id, 'inbound', northId, false);
    cleared = must(store.getState().system.services.find((sv) => sv.id === sSvc)).patterns[0];
  });

  it('both directions call at both stops to begin with', () => {
    expect(idsOnInboundBefore).toHaveLength(2);
  });

  it('skipping a stop removes it from that direction', () => {
    expect(idsOnInboundAfterSkip).not.toContain(northId);
  });

  it('the other direction still calls there', () => {
    expect(idsOnOutboundAfterSkip).toContain(northId);
  });

  it('a skipped stop survives a save and a reload', () => {
    expect(rp.skippedStops?.inbound ?? []).toContain(northId);
  });

  it('a skip naming a station that no longer exists is dropped on load', () => {
    expect(dp.skippedStops).toBeUndefined();
  });

  it('un-skipping the last stop drops the record entirely', () => {
    expect(cleared.skippedStops).toBeUndefined();
  });
});

// Dragging the two halves of a couplet into one street is a real edit, and the
// question is what becomes of the line. Combining a boulevard's carriageways
// is the sharp version: one of the two ways it rides stops existing.
describe('a couplet meeting itself: two one-way paths brought back together', () => {
  let store: ReturnType<typeof createEditorStore>;
  let attachedOk: boolean;
  let split: Pattern;
  let combined: Service | undefined;
  let cp2: Pattern;
  let validateSystemResult: ReturnType<typeof validateSystem>;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
    store.getState().setSystem(
      parseSystem({
        version: 3,
        ways: [
          {
            id: 'blvd',
            typeId: 'road',
            points: [
              [-115.2, 36.1],
              [-115.2, 36.13],
            ],
            geometry: 'straight',
            grade: 'atGrade',
          },
        ],
        services: [],
        stations: [],
      }),
    );
    const backId = must(store.getState().separateCarriageways('blvd'));
    const cSvc = must(store.getState().addServiceToWay('blvd'));
    const cPat = must(store.getState().system.services.find((sv) => sv.id === cSvc)).patterns[0];
    attachedOk = store
      .getState()
      .attachReturnPath(cSvc, cPat.id, [{ wayId: backId, fromPoint: 1, toPoint: 0 }]);
    split = must(store.getState().system.services.find((sv) => sv.id === cSvc)).patterns[0];

    store.getState().combineCarriageways(store.getState().system.namedWays[0].id);
    combined = store.getState().system.services.find((sv) => sv.id === cSvc);
    cp2 = must(combined).patterns[0];
    // removeWay PRUNES legs naming the way it drops, so before the rescue this
    // silently deleted whichever direction rode the discarded carriageway — on a
    // couplet, the whole return trip.
    validateSystemResult = validateSystem(store.getState().system);
  });

  it('a couplet can run the two carriageways of one boulevard', () => {
    expect(attachedOk).toBe(true);
  });

  it('its two directions run the two carriageways', () => {
    expect(patternHasSplit(split)).toBe(true);
  });

  it('combining the carriageways does not delete the line', () => {
    expect(combined).toBeDefined();
  });

  it('the direction that rode the discarded carriageway is rebound, not dropped', () => {
    expect(patternRunLegs(cp2, 'inbound').length).toBeGreaterThan(0);
  });

  it('both directions now run the one street that is left', () => {
    expect(patternRunLegs(cp2, 'outbound').every((r) => r.leg.wayId === 'blvd')).toBe(true);
    expect(patternRunLegs(cp2, 'inbound').every((r) => r.leg.wayId === 'blvd')).toBe(true);
  });

  it('a line running one street both ways is no longer a couplet', () => {
    expect(patternHasSplit(cp2)).toBe(false);
    expect(cp2.sections.every((x) => x.kind === 'shared')).toBe(true);
  });

  it('combining the carriageways leaves nothing to report', () => {
    expect(validateSystemResult).toHaveLength(0);
  });
});
