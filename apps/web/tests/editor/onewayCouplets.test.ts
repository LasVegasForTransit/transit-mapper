import { beforeEach, describe, expect, it } from 'vitest';
import {
  patternHasSplit,
  patternLegs,
  patternRunLegs,
  patternRunPath,
  pathLengthMeters,
  serviceWayIds,
} from '@transitmapper/core/model/geo';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { validateSystem } from '@transitmapper/core/model/validate';
import { anchorOnWay } from '@transitmapper/core/model/routeGraph';
import { serviceStats } from '@transitmapper/core/sim/serviceStats';
import type { LngLat, Pattern, Service, TransitSystem } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

/** A non-null assertion by another name — `!` is banned by lint, this isn't. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value, got null/undefined');
  return value;
}

// The gesture is: draw a line, then draw its return path round the block. What
// comes back has to be ONE line with two directions, not two lines, because it
// shares a name, a headway and a fleet.
describe("a couplet's two directions run different streets", () => {
  let store: ReturnType<typeof createEditorStore>;
  let svc: string;
  let outPatternHasSplit: boolean;
  let startReturnOk: boolean;
  let traceOk: boolean;
  let commitEqualsSvc: boolean;
  let serviceCountAfterCommit: number;
  let coupled: Service;
  let cp: Pattern;
  let coupledHasSplit: boolean;
  let outWays: string[];
  let backWays: string[];
  let rpHasSplit: boolean;
  let reloadedWayIdsLength: number;
  let reloadedOutboundWayIds: string[];
  let outboundWayIds: string[];
  let reloadedInboundWayIds: string[];
  let inboundWayIds: string[];
  let reloadedNotBroken: boolean;
  let roundTripSumDiffMs: number;
  let roundTripDoubleDiffMs: number;
  let returnLongerThanOutward: boolean;
  let noGapReported: boolean;
  let adoptRefused: boolean;
  let trimmedCp: Pattern;
  let trimmedHasSplit: boolean;
  let trimmedShorterThanBefore: boolean;
  let farAwayRefused: boolean;
  let sectionsBeforeFarAwayAttempt: Pattern['sections'];
  let sectionsAfterFarAwayAttempt: Pattern['sections'];
  let cutProducesSecond: boolean;
  let cutAddsExactlyOne: boolean;
  let halvesCount: number;
  let halvesAllCouplets: boolean;
  let halvesRunOutwardOnUp: boolean;
  let halvesHaveOwnReturn: boolean;
  let noneHalfBroken: boolean;
  let flat: Pattern;
  let flatNotSplit: boolean;
  let flatKeepsUp: boolean;

  beforeEach(() => {
    store = createEditorStore();
    const SWc: LngLat = [-115.2, 36.1];
    const NWc: LngLat = [-115.2, 36.14];
    const NEc: LngLat = [-115.19, 36.14];
    const SEc: LngLat = [-115.19, 36.1];
    const blockWay = (id: string, points: LngLat[]) => ({
      id,
      typeId: 'road',
      points,
      geometry: 'straight',
      grade: 'atGrade',
    });
    // Built as a document rather than drawn, because parseSystem derives a
    // junction wherever control points coincide and the headless draw flow has
    // no snapping to form them with.
    store.commands.document.setSystem(
      parseSystem({
        version: 3,
        ways: [
          blockWay('up', [SWc, NWc]),
          blockWay('north', [NWc, NEc]),
          blockWay('down', [NEc, SEc]),
          blockWay('south', [SEc, SWc]),
        ],
        services: [],
        stations: [],
      }),
    );
    store.commands.tools.setDraftMode('bus');
    svc = must(store.commands.services.addServiceToWay('up'));
    const outPattern = must(store.getState().system.services.find((sv) => sv.id === svc)).path;
    outPatternHasSplit = patternHasSplit(outPattern);

    startReturnOk = store.commands.routing.startReturnPathDraft(svc, outPattern.id);

    const anchorAt = (wayId: string, coord: LngLat) =>
      must(anchorOnWay(must(store.getState().system.ways.find((x) => x.id === wayId)), coord));
    const midOf = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    traceOk =
      store.commands.routing.extendRouteDraft(anchorAt('north', midOf(NWc, NEc))) &&
      store.commands.routing.extendRouteDraft(anchorAt('down', midOf(NEc, SEc))) &&
      store.commands.routing.extendRouteDraft(anchorAt('south', midOf(SEc, SWc)));

    commitEqualsSvc = store.commands.routing.commitRouteDraft() === svc;
    serviceCountAfterCommit = store.getState().system.services.length;

    coupled = must(store.getState().system.services.find((sv) => sv.id === svc));
    cp = coupled.path;
    coupledHasSplit = patternHasSplit(cp);

    outWays = patternRunLegs(cp, 'outbound').map((r) => r.leg.wayId);
    backWays = patternRunLegs(cp, 'inbound').map((r) => r.leg.wayId);

    // Round-tripping is where this feature can be lost silently: the couplet is
    // correct in memory, gets saved, and comes back as a line that runs over no
    // ways at all. That is exactly what happened — parsePatterns only knew how
    // to read the flat leg list, so a saved couplet reloaded as nothing.
    {
      const reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
      const rp = must(reloaded.services.find((sv) => sv.id === svc)).path;
      rpHasSplit = patternHasSplit(rp);
      reloadedWayIdsLength = serviceWayIds(
        must(reloaded.services.find((sv) => sv.id === svc)),
      ).length;
      reloadedOutboundWayIds = patternRunLegs(rp, 'outbound').map((r) => r.leg.wayId);
      outboundWayIds = patternRunLegs(cp, 'outbound').map((r) => r.leg.wayId);
      reloadedInboundWayIds = patternRunLegs(rp, 'inbound').map((r) => r.leg.wayId);
      inboundWayIds = patternRunLegs(cp, 'inbound').map((r) => r.leg.wayId);
      reloadedNotBroken = !validateSystem(reloaded).some(
        (i) => i.id.startsWith('broken-pattern-') || i.id.startsWith('ghost-service-'),
      );
    }

    // The whole point of the sim change: the cycle is the two directions added
    // together, and this couplet's return is genuinely longer than its outward.
    const ps = must(
      serviceStats(store.getState().system.ways, store.getState().system.stops, [], coupled),
    ).path;
    roundTripSumDiffMs = Math.abs(
      ps.roundTripMs - (ps.timetables.outbound.oneWayMs + ps.timetables.inbound.oneWayMs),
    );
    roundTripDoubleDiffMs = Math.abs(ps.roundTripMs - 2 * ps.timetables.outbound.oneWayMs);
    returnLongerThanOutward =
      ps.timetables.inbound.totalMeters > ps.timetables.outbound.totalMeters;

    // A couplet must not read as a broken route: its two halves are a block
    // apart on purpose, and the old single-walk check called that a gap.
    noGapReported = !validateSystem(store.getState().system).some((i) =>
      i.id.startsWith('broken-pattern-'),
    );

    // Adoption would replace the whole path with one routed line, silently
    // discarding the direction it was drawn with.
    adoptRefused = store.commands.routing.adoptExistingInfrastructure(svc) === 0;

    // Trimming cuts BOTH directions — the return's matching point is found on
    // its own street rather than assumed to be the same leg.
    const outBefore = pathLengthMeters(
      patternRunPath(store.getState().system.ways, cp, 'outbound'),
    );
    store.commands.services.trimPatternTo(svc, cp.id, 'up', 0.5, 'end');
    trimmedCp = must(store.getState().system.services.find((sv) => sv.id === svc)).path;
    trimmedHasSplit = patternHasSplit(trimmedCp);
    trimmedShorterThanBefore =
      pathLengthMeters(patternRunPath(store.getState().system.ways, trimmedCp, 'outbound')) <
      outBefore - 1;

    // A return path drawn nowhere near the line must not attach. The dangerous
    // failure is not refusing — it is guessing, because the only guess available
    // is "the whole line is a couplet", which splits a line end to end when
    // someone drew one block of it miles away.
    {
      const farWays = store.getState().system.ways;
      const faraway = must(farWays.map((w) => w.id).find((wid) => wid === 'down'));
      const spansFarAway = [
        { wayId: faraway, fromPoint: 0, toPoint: 1, fromCoord: [-114.5, 35.5] as LngLat },
      ];
      const sectionsOf = () =>
        must(store.getState().system.services.find((sv) => sv.id === svc)).path.sections;
      sectionsBeforeFarAwayAttempt = sectionsOf();
      farAwayRefused = !store.commands.routing.attachReturnPath(svc, trimmedCp.id, spansFarAway);
      sectionsAfterFarAwayAttempt = sectionsOf();
    }

    // Cutting a couplet in two has to leave two couplets. Doing it on the
    // flattened leg list would hand back two flat lines and lose the direction
    // structure without saying so.
    {
      const beforeCount = store.getState().system.services.length;
      // 0.25, not 0.5: the trim above already cut `up` back to [0, 0.5], so 0.5
      // is now this line's terminus and cutting there is correctly refused.
      const spawnedId = store.commands.services.splitServiceAt(svc, trimmedCp.id, 'up', 0.25);
      const after = store.getState().system;
      cutProducesSecond = !!spawnedId;
      cutAddsExactlyOne = after.services.length === beforeCount + 1;
      const halves = after.services.filter((sv) => sv.id === svc || sv.id === spawnedId);
      halvesCount = halves.length;
      halvesAllCouplets = halves.every((sv) => patternHasSplit(sv.path));
      halvesRunOutwardOnUp = halves.every((sv) =>
        patternRunLegs(sv.path, 'outbound')
          .map((r) => r.leg.wayId)
          .includes('up'),
      );
      halvesHaveOwnReturn = halves.every((sv) => {
        const back = patternRunLegs(sv.path, 'inbound').map((r) => r.leg.wayId);
        return back.length > 0 && !back.includes('up');
      });
      noneHalfBroken = !validateSystem(after).some((i) => i.id.startsWith('broken-pattern-'));
      // Put the spawned half back so the checks below still see one line.
      store.commands.services.deleteService(must(spawnedId));
    }

    // And it can be undone.
    store.commands.services.makePatternTwoWay(svc, trimmedCp.id);
    flat = must(store.getState().system.services.find((sv) => sv.id === svc)).path;
    flatNotSplit = !patternHasSplit(flat);
    flatKeepsUp = patternRunLegs(flat, 'outbound')
      .map((r) => r.leg.wayId)
      .includes('up');
  });

  it('a plain line starts with one undivided path', () => {
    expect(outPatternHasSplit).toBe(false);
  });

  it('drawing a return path starts from the far end of the outward trip', () => {
    expect(startReturnOk).toBe(true);
  });

  it('the return path can be traced round the block', () => {
    expect(traceOk).toBe(true);
  });

  it('committing a return path keeps it on the same line', () => {
    expect(commitEqualsSvc).toBe(true);
  });

  it('the system still holds exactly one line', () => {
    expect(serviceCountAfterCommit).toBe(1);
  });

  it("the line's two directions now run different streets", () => {
    expect(coupledHasSplit).toBe(true);
  });

  it('the outward trip still runs the street it was drawn on', () => {
    expect(outWays).toContain('up');
  });

  it('the return trip runs the streets it was traced along', () => {
    expect(backWays).toContain('down');
  });

  it('the outward trip never runs the return street', () => {
    expect(outWays).not.toContain('down');
  });

  it('the return trip never runs the outward street', () => {
    expect(backWays).not.toContain('up');
  });

  it('a couplet survives a save and a reload', () => {
    expect(rpHasSplit).toBe(true);
  });

  it('a reloaded couplet still runs over its ways', () => {
    expect(reloadedWayIdsLength).toBe(4);
  });

  it('a reloaded couplet keeps each direction on its own streets', () => {
    expect(reloadedOutboundWayIds).toEqual(outboundWayIds);
    expect(reloadedInboundWayIds).toEqual(inboundWayIds);
  });

  it('a reloaded couplet is not reported as broken', () => {
    expect(reloadedNotBroken).toBe(true);
  });

  it('the round trip is the outward trip plus the return, not twice either', () => {
    expect(roundTripSumDiffMs).toBeLessThan(1e-6);
    expect(roundTripDoubleDiffMs).toBeGreaterThan(1);
  });

  it('the return trip is measured on its own longer path', () => {
    expect(returnLongerThanOutward).toBe(true);
  });

  it('a couplet is not reported as having a gap in its route', () => {
    expect(noGapReported).toBe(true);
  });

  it('adopting infrastructure refuses to flatten a couplet', () => {
    expect(adoptRefused).toBe(true);
  });

  it('trimming a couplet keeps both of its directions', () => {
    expect(trimmedHasSplit).toBe(true);
  });

  it('trimming a couplet shortens the outward trip', () => {
    expect(trimmedShorterThanBefore).toBe(true);
  });

  it('a return path that ends nowhere near the line is refused', () => {
    expect(farAwayRefused).toBe(true);
  });

  it('refusing a far-away return path leaves the line exactly as it was', () => {
    expect(sectionsAfterFarAwayAttempt).toEqual(sectionsBeforeFarAwayAttempt);
  });

  it('cutting a couplet in two produces a second line', () => {
    expect(cutProducesSecond).toBe(true);
  });

  it('cutting a couplet adds exactly one line', () => {
    expect(cutAddsExactlyOne).toBe(true);
  });

  it('both halves of a cut couplet are still couplets', () => {
    expect(halvesCount).toBe(2);
    expect(halvesAllCouplets).toBe(true);
  });

  it('each half still runs its outward trip on the outward street', () => {
    expect(halvesRunOutwardOnUp).toBe(true);
  });

  it('each half still has a return trip on its own streets', () => {
    expect(halvesHaveOwnReturn).toBe(true);
  });

  it('neither half of a cut couplet is reported as broken', () => {
    expect(noneHalfBroken).toBe(true);
  });

  it('a couplet can be turned back into a two-way line', () => {
    expect(flatNotSplit).toBe(true);
  });

  it('undoing a couplet keeps the streets the outward trip ran', () => {
    expect(flatKeepsUp).toBe(true);
  });
});

// Deleting a stretch of road from under a line that runs its whole length:
// the road is cut, and the line survives as two pieces rather than losing
// whichever half is shorter.
describe('deleting a stretch of road from under a line that runs its whole length', () => {
  let store: ReturnType<typeof createEditorStore>;
  let svcId: string;
  let affected: number;
  let after: TransitSystem;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const road = must(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    svcId = store.getState().system.services[0].id;

    affected = store.commands.network.deleteWayStretch(road, 0.4, 0.6);
    after = store.getState().system;
  });

  it('deleting a stretch reports the line it cut', () => {
    expect(affected).toBe(1);
  });

  it('the road is left as the two pieces either side', () => {
    expect(after.ways).toHaveLength(2);
  });

  it('the line survives as two pieces rather than losing half of itself', () => {
    expect(after.lines.find((line) => line.serviceIds.includes(svcId))?.serviceIds).toHaveLength(2);
  });

  it('no surviving piece names a way that was deleted', () => {
    expect(
      after.services.every((service) =>
        patternLegs(service.path).every((leg) => after.ways.some((way) => way.id === leg.wayId)),
      ),
    ).toBe(true);
  });

  it('the surviving system has no route with a gap in it', () => {
    expect(validateSystem(after).every((i) => !i.id.startsWith('broken-pattern'))).toBe(true);
  });
});

// The Demolish tool's whole-way click path relies on this: a stretch
// spanning end-to-end degrades to a full-way removal, same as deleteWay,
// rather than leaving a zero-length stub behind.
describe('a stretch spanning the whole way removes it entirely', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = must(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.network.deleteWayStretch(road, 0, 1);
  });

  it('a stretch spanning the whole way removes it entirely', () => {
    expect(store.getState().system.ways.some((w) => w.id === road)).toBe(false);
  });
});

// A demolished OSM-imported way's surviving stubs must keep their
// provenance — deleteWayStretch cuts via splitWay, whose spread already
// preserves `source`, so the "Imported from OpenStreetMap" badge and the
// Demolish tool's no-confirm-dialog decision both stay correct after a cut.
describe('a demolished OSM-imported way keeps its provenance', () => {
  let store: ReturnType<typeof createEditorStore>;
  let survivors: TransitSystem['ways'];

  beforeEach(() => {
    store = createEditorStore();
    const road = must(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.document.setSystem({
      ...store.getState().system,
      ways: store
        .getState()
        .system.ways.map((w) => (w.id === road ? { ...w, source: 'osm:1' } : w)),
    });
    store.commands.network.deleteWayStretch(road, 0.4, 0.6);
    survivors = store.getState().system.ways;
  });

  it('demolishing a stretch leaves two surviving pieces', () => {
    expect(survivors).toHaveLength(2);
  });

  it('both surviving pieces of a demolished OSM way keep their source', () => {
    expect(survivors.every((w) => w.source === 'osm:1')).toBe(true);
  });
});
