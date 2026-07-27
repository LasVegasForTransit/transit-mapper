// Deterministic verification of the editor/model logic without a browser.
// Run with: node scripts/verify.ts  (or: npm run verify)
import { createEditorStore } from '../src/editor/store';
import { parseSystem, forkSystem, createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  MODE_ORDER,
  MODES,
  modesForWayType,
  vehicleFootprint,
  wayType,
  WAY_TYPE_ORDER,
} from '@transitmapper/core/model/catalog';
import {
  roundedCorners,
  squareFootprint,
  systemBounds,
  wayLengthMeters,
  INTERCHANGE_METERS,
  metersFromOrigin,
  offsetMeters,
  nearestOnPath,
  nearestOpenEndpoint,
  pointAtT,
  pointAtDistance,
  cumulativeLengths,
  pathLengthMeters,
  resolveWayPath,
  segmentGridStats,
  servedWayIds,
  serviceWayIds,
  patternPath,
  patternWayDirection,
  serviceLaneOnWay,
  detectShapeRuns,
  snap,
  MAX_GRID_CELLS,
  MAX_OVERSIZE_SEGMENTS,
  wayById,
} from '@transitmapper/core/model/geo';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import {
  angleSnap,
  attachInteractions,
  continueStraight,
  isDoubleClickFinish,
} from '../src/map/interactions';
import { KEY_BINDINGS, matchesKey, resolveBinding, type KeyContext } from '../src/editor/keymap';
import { buildFeatures, HANDLE_ICON, LAYER_SPECS, SRC_PREVIEW } from '../src/map/layers';
import { LANDMARKS, landmarksFeatureCollection } from '../src/map/landmarks';
import {
  buildOverpassQuery,
  classifyOsmWay,
  gradeFromOsmTags,
  osmElementsToNetwork,
  osmElementsToWays,
  profileFromOsmTags,
  withoutAlreadyImported,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import {
  classifyGtfsRouteType,
  gtfsFilesToBatchedPieces,
  gtfsFilesToSystemPieces,
  parseGtfsCsv,
} from '@transitmapper/core/model/gtfsImport';
import { legendEntriesFor } from '../src/share/exportLegend';
import { formatScaleMeters, niceScaleMeters } from '../src/share/exportScale';
import { FEATURE_INPUT_ROLE } from '@transitmapper/core/render/featureInputs';
import { fitBounds, metersPerPixel, projector } from '@transitmapper/core/render/project';
import {
  PREVIEW_FONT_FAMILY,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  previewSvg,
} from '@transitmapper/core/render/preview';
import { systemSvg } from '@transitmapper/core/render/svg';
import { LVBT } from '@transitmapper/core/style/lvbtBrand';
import {
  checkPreviewPng,
  MAX_PREVIEW_BYTES,
  pngDimensions,
} from '@transitmapper/core/render/pngBytes';
import { validateSystem } from '@transitmapper/core/model/validate';
import { estimateWayCapitalCost, formatUsdCompact } from '@transitmapper/core/model/cost';
import {
  LANE_KINDS,
  laneKind,
  PROFILE_PRESETS,
  profilePresetsForWayType,
  WAY_FAMILIES,
  WAY_TYPES,
} from '@transitmapper/core/model/catalog';
import {
  buildProfile,
  combineProfiles,
  defaultLaneFor,
  defaultProfileFor,
  flipProfile,
  isOneWay,
  laneCapacity,
  makeOneWay,
  MAX_PRIMARY_LANES,
  makeTwoWay,
  profileWidthM,
  separateProfiles,
  travelLanes,
  directionalLanes,
  wayCapacity,
  withLaneCount,
} from '@transitmapper/core/model/profile';
import { offsetPolyline } from '@transitmapper/core/model/geo';
import {
  serviceLanePath,
  trimPath,
  wayLaneGeometry,
  wayIntersectsBounds,
} from '@transitmapper/core/geometry/streets';
import {
  patternWayTraversals,
  selectVehicleLane,
  patternLanePath,
} from '@transitmapper/core/geometry/vehicleLane';
import { bearingAtT, rotatedRectPolygon } from '@transitmapper/core/model/geo';
import {
  classifyTurn,
  collectWayTrims,
  connectorCurves,
  defaultConnectors,
  effectiveConnectors,
  incomingLanes,
  junctionGeometry,
  outgoingLanes,
} from '@transitmapper/core/geometry/junctions';
import { wayCrossings } from '@transitmapper/core/model/validate';
import { anchorOnWay, routeBetween, routePath } from '@transitmapper/core/model/routeGraph';
// `snap` and `squareFootprint` come from the same module in the import block
// at the top of this file; naming them twice was a duplicate-identifier error
// that only ran because tsx tolerates what tsc rejects.
import { bearingDegrees, formatBearing, haversineMeters } from '@transitmapper/core/model/geo';
import type {
  CrossSection,
  LngLat,
  Node,
  Service,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import {
  armRefKey,
  getComponent,
  laneRefKey,
  withComponent,
  withoutComponent,
} from '@transitmapper/core/model/components';
import { dwellStopsForPattern, effectiveVehicleKind } from '../src/sim/vehicles';
import {
  buildTimetable,
  metersAtElapsed,
  VEHICLE_SPEED_MPS,
} from '@transitmapper/core/sim/timetable';
import {
  generateToken,
  hashToken,
  sha256Base64Url,
  toBase64Url,
} from '@transitmapper/core/auth/tokens';
import { parseCookies, serializeCookie } from '@transitmapper/core/auth/cookies';
import { safeReturnTo } from '@transitmapper/core/auth/returnTo';
import { buildAuthorizeUrl } from '@transitmapper/core/auth/google';
import { ANONYMOUS_SHARE_TTL_MS, newShareOwnership } from '@transitmapper/core/share/ownership';
import { claimOutcome, retainedShares } from '@transitmapper/core/share/claim';
// Imported for the storage block at the end of this file. localStore only
// touches `localStorage` inside its functions, never at module scope, so the
// fake can be installed after the import rather than before it.
import {
  deleteFromLibrary,
  listLibrary,
  loadSystemEntry,
  migrateLegacySingleSlot,
  saveToLibrary,
} from '../src/storage/localStore';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(cond ? `  ok  ${name}` : `FAIL  ${name}`);
  if (!cond) failures++;
}

const store = createEditorStore();
const ed = store.getState();
const fresh = () => ed.setSystem(createEmptySystem());
const servicesOnWay = (wid: string) =>
  store.getState().system.services.filter((s) => serviceWayIds(s).includes(wid));

// --- drawing a way creates a way + one service ---
fresh();
const a = store.getState().beginWay('lightRail', 'straight');
store.getState().addWayPoint(a, [-115.24, 36.1]);
store.getState().addWayPoint(a, [-115.17, 36.16]);
store.getState().addWayPoint(a, [-115.1, 36.1]);
store.getState().finishWay();
let sys = store.getState().system;
check('way defined by 3 control points', sys.ways.find((w) => w.id === a)!.points.length === 3);
check('drawing a way creates exactly one service', sys.services.length === 1);
check('the service runs over that way', sys.services[0].patterns[0].wayIds[0] === a);

// --- multiple services share one way (the service/infra split) ---
const svc2 = store.getState().addServiceToWay(a);
check('a way can carry multiple services', servicesOnWay(a).length === 2);
check('added service is distinct', svc2 !== store.getState().system.services[0].id);

// --- bare infrastructure: bike ways carry no service (catalog-driven, no default mode) ---
fresh();
check('bike way type has no compatible service modes', modesForWayType('bike').length === 0);
const bikeWay = store.getState().beginWay('bike', 'straight');
store.getState().addWayPoint(bikeWay, [-115.2, 36.1]);
store.getState().addWayPoint(bikeWay, [-115.1, 36.1]);
store.getState().finishWay();
check('drawing a bike way creates no service', store.getState().system.services.length === 0);
check(
  'addServiceToWay on a bike way returns null',
  store.getState().addServiceToWay(bikeWay) === null,
);

// --- roads draw exactly like every other way (this is the fix: roads used to not drag) ---
fresh();
const road = store.getState().beginWay('road', 'straight');
store.getState().addWayPoint(road, [-115.2, 36.1]);
store.getState().addWayPoint(road, [-115.1, 36.2]);
store.getState().finishWay();
check(
  'road way created with 2 points via the same beginWay/addWayPoint path',
  store.getState().system.ways[0].points.length === 2,
);
// With the draft's service toggle on (the default, and always the case in
// Network view's mode-first drawing) a road still gets its line; the
// Infrastructure view's Way tool turns the toggle OFF for roads so streets
// draw as bare context — see the "bare infrastructure toggle" block below.
check(
  'drawing a road with service enabled creates a default service (bus/BRT)',
  servicesOnWay(road).length === 1,
);
check(
  'road defaults to the arterial class',
  store.getState().system.ways[0].classId === 'arterial',
);

// --- heavy rail and light rail are physically incompatible track standards ---
{
  const heavy = modesForWayType('heavyRail').map((m) => m.id);
  const light = modesForWayType('lightRail').map((m) => m.id);
  check(
    'subway/commuter rail ride heavy rail only',
    heavy.includes('subway') && heavy.includes('commuterRail'),
  );
  check(
    'heavy rail never carries light-rail-standard modes',
    !heavy.includes('lightRail') && !heavy.includes('tram'),
  );
  check(
    'light rail/tram never rides heavy rail',
    !light.includes('subway') && !light.includes('commuterRail'),
  );
  check(
    'monorail is a third, separate standard',
    modesForWayType('monorail').every((m) => m.id === 'monorail'),
  );
}

// --- a tram can street-run on a road way or use dedicated light-rail track ---
{
  const tramWayTypes = new Set(MODES.tram.wayTypeIds);
  check(
    'tram is compatible with both dedicated light rail and street-running road',
    tramWayTypes.has('lightRail') && tramWayTypes.has('road'),
  );
}

// --- defaultLaneFor: a service's default lane on a way (curb / bus lane / track) ---
{
  const twoWay = defaultProfileFor('road', 2);
  const dir = directionalLanes(twoWay);
  const lastFwd = [...dir]
    .reverse()
    .find((l) => l.direction === 'forward' || l.direction === 'both');
  const firstBwd = dir.find((l) => l.direction === 'backward' || l.direction === 'both');
  const fwd = defaultLaneFor(twoWay, 'forward');
  const bwd = defaultLaneFor(twoWay, 'backward');
  check('defaultLaneFor forward = rightmost (last) forward directional lane', fwd === lastFwd?.id);
  check(
    'defaultLaneFor backward = rightmost (first) backward directional lane',
    bwd === firstBwd?.id,
  );
  check('forward and backward defaults differ on a two-way road', !!fwd && fwd !== bwd);

  // A one-way carriageway resolves a lane for its single travel direction.
  const oneWay = makeOneWay(defaultProfileFor('road', 2), 'forward');
  check('one-way carriageway resolves its forward lane', !!defaultLaneFor(oneWay, 'forward'));

  // preferKindIds: a dedicated bus lane wins over a plain drive lane.
  const withBus = buildProfile([
    { kindId: 'drive', direction: 'forward' },
    { kindId: 'bus', direction: 'forward' },
  ]);
  const busId = withBus.lanes.find((l) => l.kindId === 'bus')!.id;
  const driveId = withBus.lanes.find((l) => l.kindId === 'drive')!.id;
  check(
    "defaultLaneFor prefers a bus lane for buses (preferKindIds=['bus','drive'])",
    defaultLaneFor(withBus, 'forward', ['bus', 'drive']) === busId,
  );
  check(
    'without a bus preference it takes the rightmost drive lane',
    defaultLaneFor(withBus, 'forward', ['drive']) === driveId,
  );

  // Rail: a two-track line resolves to the direction's track, never a road lane.
  const rail = defaultProfileFor('heavyRail', 2);
  const railFwd = defaultLaneFor(rail, 'forward', ['track']);
  const railBwd = defaultLaneFor(rail, 'backward', ['track']);
  check(
    'rail forward/backward resolve to different tracks',
    !!railFwd && !!railBwd && railFwd !== railBwd,
  );
  check(
    'rail default lane is a track',
    travelLanes(rail).find((l) => l.id === railFwd)?.kindId === 'track',
  );
}

// --- Pattern.lanes round-trips through serialize/parse ---
{
  fresh();
  const w = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(w, [-115.2, 36.12]);
  store.getState().addWayPoint(w, [-115.1, 36.12]);
  store.getState().finishWay();
  const svc = store.getState().system.services[0];
  const laneId = defaultLaneFor(store.getState().system.ways[0].profile, 'forward')!;
  // Hand-build a pattern lane assignment and round-trip the whole system.
  const withLanes = {
    ...store.getState().system,
    services: [{ ...svc, patterns: svc.patterns.map((p) => ({ ...p, lanes: { [w]: laneId } })) }],
  };
  const reparsed = parseSystem(JSON.parse(JSON.stringify(withLanes)));
  check(
    'Pattern.lanes survives a serialize/parse round-trip',
    reparsed.services[0].patterns[0].lanes?.[w] === laneId,
  );
  // A lane pinned to a way NOT in the pattern is dropped on parse.
  const withStray = {
    ...store.getState().system,
    services: [
      { ...svc, patterns: svc.patterns.map((p) => ({ ...p, lanes: { 'ghost-way': laneId } })) },
    ],
  };
  check(
    'Pattern.lanes drops entries for ways not in the pattern',
    parseSystem(JSON.parse(JSON.stringify(withStray))).services[0].patterns[0].lanes === undefined,
  );
}

// --- drawing a service along an existing way SHARES that infrastructure ---
// The Network Way tool routes a new service over a nearby corridor instead of
// laying a parallel way (Phase A share-by-default). Exercised here through the
// same route-draft actions the pointer layer calls (startRouteDraft →
// extendRouteDraft → commitRouteDraft).
{
  fresh();
  store.getState().setDraftMode('bus');
  const road = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(road, [-115.3, 36.1]);
  store.getState().addWayPoint(road, [-115.2, 36.1]);
  store.getState().addWayPoint(road, [-115.1, 36.1]);
  store.getState().finishWay();
  const s1Id = store.getState().system.services[0].id;
  const w = store.getState().system.ways.find((x) => x.id === road)!;
  // Interior anchors (mid-corridor, as a real click would land) so the route
  // genuinely traverses the existing way rather than a degenerate end sliver.
  const from = anchorOnWay(w, [-115.28, 36.1])!;
  const to = anchorOnWay(w, [-115.12, 36.1])!;
  store.getState().startRouteDraft(from);
  const extended = store.getState().extendRouteDraft(to);
  const newId = store.getState().commitRouteDraft();
  check('route-draft extends along the existing way', extended === true);
  check(
    'committing a routed draft adds a second service',
    !!newId && store.getState().system.services.length === 2,
  );
  // Re-fetch BOTH services from the post-commit store — materialization may
  // have split the shared road and rebound the original service's way ids.
  const s1 = store.getState().system.services.find((sv) => sv.id === s1Id)!;
  const s2 = store.getState().system.services.find((sv) => sv.id === newId)!;
  const shared = serviceWayIds(s1).some((wid) => serviceWayIds(s2).includes(wid));
  check('a service drawn along an existing corridor SHARES its infrastructure', shared);
}

// --- continuity-aware bundle offsets: a through-line keeps ONE offset across a
// shared stretch (no sideways jog where the shared segment begins/ends) ---
{
  fresh();
  store.getState().setDraftMode('lightRail');
  const A = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(A, [-115.3, 36.1]);
  store.getState().addWayPoint(A, [-115.2, 36.1]);
  store.getState().addWayPoint(A, [-115.1, 36.1]);
  store.getState().finishWay();
  const aId = store.getState().system.services[0].id;
  // Route a second service along A's middle → A splits into 3 ways, the new
  // service rides only the shared middle (bundle sizes 1 / 2 / 1 along A).
  const w = store.getState().system.ways.find((x) => x.id === A)!;
  store.getState().startRouteDraft(anchorOnWay(w, [-115.27, 36.1])!);
  store.getState().extendRouteDraft(anchorOnWay(w, [-115.13, 36.1])!);
  const bId = store.getState().commitRouteDraft()!;

  const filters = {
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set(['lightRail', 'road']),
  };
  const net = buildFeatures(store.getState().system, null, [], { viewMode: 'network', ...filters });
  const aFeats = net.services.features.filter((f) => f.properties?.serviceId === aId);
  const bFeats = net.services.features.filter((f) => f.properties?.serviceId === bId);
  const aOffsets = new Set(aFeats.map((f) => f.properties?.offset));
  check(
    'the through-line spans several ways (a shared stretch was carved out)',
    aFeats.length >= 2,
  );
  check(
    'a through-line keeps ONE constant offset across all its ways (no jog)',
    aOffsets.size === 1,
  );
  check(
    'the joining service takes a different offset where they share',
    bFeats.length >= 1 && !aOffsets.has(bFeats[0].properties?.offset),
  );
}

// --- wayIntersectsBounds is segment-aware, so lane detail isn't culled when
// you zoom into the MIDDLE of a long way (both its vertices off-screen) ---
{
  fresh();
  const w = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(w, [-115.3, 36.1]);
  store.getState().addWayPoint(w, [-115.0, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways.find((x) => x.id === w)!;
  // A tiny viewport in the MIDDLE of the way — both endpoints far outside it.
  check(
    'segment crossing a mid-way viewport counts (both vertices outside)',
    wayIntersectsBounds(
      way,
      [
        [-115.151, 36.099],
        [-115.149, 36.101],
      ],
      0,
    ),
  );
  // A viewport nowhere near the alignment does not.
  check(
    'a viewport off the alignment does not count',
    !wayIntersectsBounds(
      way,
      [
        [-115.151, 36.5],
        [-115.149, 36.502],
      ],
      0,
    ),
  );
}

// --- lane-accurate service rendering (Infrastructure view) ---
// A committed pattern stores no travel direction, so patternWayDirection derives
// it from geometry; serviceLaneOnWay resolves the curb/track lane; buildFeatures
// draws the service on that lane in lane detail, on the centerline in Network.
{
  const P0: LngLat = [-115.2, 36.1],
    P1: LngLat = [-115.15, 36.1],
    P2: LngLat = [-115.1, 36.1];
  const mkWay = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [] },
  });
  // wayA [P0,P1] exits into wayB [P1,P2] at wayA's LAST point → forward.
  const fwd = new Map<string, Way>([
    ['a', mkWay('a', [P0, P1])],
    ['b', mkWay('b', [P1, P2])],
  ]);
  check(
    "patternWayDirection: exit at the way's last point → forward",
    patternWayDirection({ id: 'p', wayIds: ['a', 'b'] }, 0, fwd) === 'forward',
  );
  // wayA points [P1,P0] → it exits into wayB at wayA's FIRST point → backward.
  const bwd = new Map<string, Way>([
    ['a', mkWay('a', [P1, P0])],
    ['b', mkWay('b', [P1, P2])],
  ]);
  check(
    "patternWayDirection: exit at the way's first point → backward",
    patternWayDirection({ id: 'p', wayIds: ['a', 'b'] }, 0, bwd) === 'backward',
  );
  check(
    'patternWayDirection: a single-way pattern defaults to forward',
    patternWayDirection({ id: 'p', wayIds: ['a'] }, 0, fwd) === 'forward',
  );
}

{
  const road = defaultProfileFor('road', 2);
  const roadMap = new Map<string, Way>([
    [
      'w',
      {
        id: 'w',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: road,
      },
    ],
  ]);
  check(
    'serviceLaneOnWay: a bus resolves the forward-curb travel lane',
    serviceLaneOnWay({ id: 'p', wayIds: ['w'] }, 0, roadMap, 'bus') ===
      defaultLaneFor(road, 'forward', ['bus', 'drive']),
  );
  const pinId = road.lanes[0].id;
  check(
    'serviceLaneOnWay: an explicit pattern.lanes pin overrides the default',
    serviceLaneOnWay({ id: 'p', wayIds: ['w'], lanes: { w: pinId } }, 0, roadMap, 'bus') === pinId,
  );
  const rail = defaultProfileFor('heavyRail', 2);
  const railMap = new Map<string, Way>([
    [
      'r',
      {
        id: 'r',
        typeId: 'heavyRail',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: rail,
      },
    ],
  ]);
  const railLane = serviceLaneOnWay({ id: 'p', wayIds: ['r'] }, 0, railMap, 'subway');
  check(
    'serviceLaneOnWay: rail resolves a track lane',
    travelLanes(rail).find((l) => l.id === railLane)?.kindId === 'track',
  );
}

{
  fresh();
  store.getState().setDraftMode('bus');
  const road = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(road, [-115.2, 36.12]);
  store.getState().addWayPoint(road, [-115.1, 36.12]);
  store.getState().finishWay();
  store.getState().setWayCapacity(road, 2);
  const sys = store.getState().system;
  const svcId = sys.services[0].id;
  const center = resolveWayPath(sys.ways.find((w) => w.id === road)!);
  const onCenterline = (coords: LngLat[]) =>
    coords.length === center.length &&
    coords.every((c, i) => c[0] === center[i][0] && c[1] === center[i][1]);
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

  const infra = buildFeatures(sys, null, [], {
    viewMode: 'infrastructure',
    laneDetail: true,
    ...filters,
  });
  const infraFeats = infra.services.features.filter((f) => f.properties?.serviceId === svcId);
  check('lane detail: the bus service renders', infraFeats.length >= 1);
  check(
    'lane detail: the service carries no paint offset (geometry IS the lane)',
    infraFeats.every((f) => f.properties?.offset === 0),
  );
  check(
    'lane detail: the service sits on a curb lane, NOT the way centerline',
    infraFeats.some((f) => !onCenterline(f.geometry.coordinates as LngLat[])),
  );

  const net = buildFeatures(sys, null, [], { viewMode: 'network', ...filters });
  const netFeats = net.services.features.filter((f) => f.properties?.serviceId === svcId);
  check(
    'network view: the service stays on the way centerline (schematic)',
    netFeats.length === 1 && onCenterline(netFeats[0].geometry.coordinates as LngLat[]),
  );
}

// --- patternLanePath: the polyline a vehicle rides in Infrastructure view ---
{
  fresh();
  store.getState().setDraftMode('bus');
  const w = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(w, [-115.2, 36.1]);
  store.getState().addWayPoint(w, [-115.15, 36.1]);
  store.getState().addWayPoint(w, [-115.1, 36.1]);
  store.getState().finishWay();
  const sys = store.getState().system;
  const waysById2 = wayById(sys.ways);
  const way = sys.ways[0];
  const pattern = sys.services[0].patterns[0];
  const lanePath = serviceLanePath(pattern, waysById2, 'bus');
  check(
    'serviceLanePath resolves a path for a single-way bus pattern',
    !!lanePath && lanePath.length >= 2,
  );
  const expectedLaneId = serviceLaneOnWay(pattern, 0, waysById2, 'bus')!;
  const expectedLane = wayLaneGeometry(way).lanes.find((l) => l.laneId === expectedLaneId)!;
  check(
    "serviceLanePath matches the resolved curb lane's own path",
    JSON.stringify(lanePath) === JSON.stringify(expectedLane.path),
  );
  check(
    'serviceLanePath is NOT the way centerline',
    JSON.stringify(lanePath) !== JSON.stringify(resolveWayPath(way)),
  );

  // A lane-less profile (no lanes at all) can't resolve — null, not a throw.
  const laneless = { ...way, profile: { lanes: [] } };
  const nullPath = serviceLanePath(pattern, new Map([[way.id, laneless]]), 'bus');
  check('serviceLanePath returns null for a lane-less profile', nullPath === null);

  // Multi-way: two ways sharing a lane-detail-eligible profile stitch into one
  // continuous path (no duplicated junction point, matching patternPath's own
  // stitching convention).
  fresh();
  store.getState().setDraftMode('bus');
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.3, 36.2]);
  store.getState().addWayPoint(a, [-115.2, 36.2]);
  store.getState().finishWay();
  const b = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(b, [-115.2, 36.2]);
  store.getState().addWayPoint(b, [-115.1, 36.2]);
  store.getState().finishWay();
  const multiPattern = { id: 'mp', wayIds: [a, b] };
  const multiWaysById = wayById(store.getState().system.ways);
  const multiPath = serviceLanePath(multiPattern, multiWaysById, 'bus');
  check(
    'serviceLanePath stitches a multi-way pattern into one continuous path',
    !!multiPath && multiPath.length >= 3,
  );
}

// --- a station snaps onto a way and follows it when reshaped ---
fresh();
const h = store.getState().beginWay('road', 'straight');
store.getState().addWayPoint(h, [-115.24, 36.1]);
store.getState().addWayPoint(h, [-115.1, 36.1]);
store.getState().finishWay();
const s1 = snap(store.getState().system.ways, [-115.17, 36.104], 5000);
check('snap finds the nearby way', !!s1 && s1.wayId === h);
const stId = store.getState().addStation(s1!.coord, { wayId: h, t: s1!.t });
const beforeLat = store.getState().system.stations.find((s) => s.id === stId)!.coord[1];
store.getState().moveWayPoint(h, 0, [-115.24, 36.16]);
store.getState().moveWayPoint(h, 1, [-115.1, 36.16]);
const afterLat = store.getState().system.stations.find((s) => s.id === stId)!.coord[1];
check('station follows its way when reshaped', afterLat > beforeLat + 0.02);

// --- snap picks the NEAREST of several candidate ways ---
{
  fresh();
  const near = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(near, [-115.101, 36.1]);
  store.getState().addWayPoint(near, [-115.101, 36.2]);
  store.getState().finishWay();
  const far = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(far, [-115.15, 36.1]);
  store.getState().addWayPoint(far, [-115.15, 36.2]);
  store.getState().finishWay();
  const best = snap(store.getState().system.ways, [-115.1, 36.15], 50000);
  check('snap picks the nearer of two candidate ways', best?.wayId === near);
}

// --- resuming a way from its open endpoint (turnkey continuation) ---
{
  fresh();
  const rw = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(rw, [-115.2, 36.1]);
  store.getState().addWayPoint(rw, [-115.1, 36.1]);
  store.getState().finishWay();

  const endHit = nearestOpenEndpoint(
    store.getState().system.ways,
    [-115.1002, 36.1001],
    500,
    'road',
  );
  check("nearestOpenEndpoint finds the way's end", endHit?.wayId === rw && endHit.end === 'end');
  const startHit = nearestOpenEndpoint(
    store.getState().system.ways,
    [-115.2001, 36.0999],
    500,
    'road',
  );
  check(
    "nearestOpenEndpoint finds the way's start",
    startHit?.wayId === rw && startHit.end === 'start',
  );
  const wrongType = nearestOpenEndpoint(
    store.getState().system.ways,
    [-115.1002, 36.1001],
    500,
    'bike',
  );
  check('nearestOpenEndpoint respects the type filter', wrongType === null);
  const farAway = nearestOpenEndpoint(store.getState().system.ways, [-114.5, 36.1], 500, 'road');
  check('nearestOpenEndpoint returns null outside the radius', farAway === null);

  // Resuming appends at the end and prepends at the start — same way, no new service.
  store.getState().resumeWay(rw);
  check(
    'resumeWay makes it the active way without creating a new one',
    store.getState().activeWayId === rw && store.getState().system.ways.length === 1,
  );
  store.getState().addWayPoint(rw, [-115.0, 36.1]);
  store.getState().insertWayPoint(rw, 0, [-115.3, 36.1]);
  const extended = store.getState().system.ways.find((w) => w.id === rw)!;
  check('extending at the end appends', extended.points[extended.points.length - 1][0] === -115.0);
  check('extending at the start prepends', extended.points[0][0] === -115.3);
  check('resuming a way never creates a second service', servicesOnWay(rw).length === 1);
}

// --- interchange emerges where a station sits on two ways' services ---
fresh();
const la = store.getState().beginWay('lightRail', 'straight');
store.getState().addWayPoint(la, [-115.2, 36.1]);
store.getState().addWayPoint(la, [-115.0, 36.1]);
store.getState().finishWay();
const lb = store.getState().beginWay('road', 'straight');
store.getState().addWayPoint(lb, [-115.1, 36.0]);
store.getState().addWayPoint(lb, [-115.1, 36.2]);
store.getState().finishWay();
{
  const near = new Set(
    servedWayIds([-115.1, 36.1], store.getState().system.ways, INTERCHANGE_METERS),
  );
  const services = store
    .getState()
    .system.services.filter((s) => serviceWayIds(s).some((w) => near.has(w)));
  check('a station at a crossing is served by two services', services.length === 2);
}

// --- deleting a way removes its services and stations ---
fresh();
const dc = store.getState().beginWay('road', 'straight');
store.getState().addWayPoint(dc, [-115.2, 36.1]);
store.getState().addWayPoint(dc, [-115.0, 36.1]);
store.getState().finishWay();
store.getState().addStation([-115.1, 36.1], { wayId: dc, t: 0.5 });
store.getState().deleteWay(dc);
check('deleting a way removes its service', store.getState().system.services.length === 0);
check('deleting a way removes its stations', store.getState().system.stations.length === 0);

// --- deleting one service leaves the way and other services ---
fresh();
const kc = store.getState().beginWay('lightRail', 'straight');
store.getState().addWayPoint(kc, [-115.2, 36.1]);
store.getState().addWayPoint(kc, [-115.0, 36.1]);
store.getState().finishWay();
const extra = store.getState().addServiceToWay(kc);
store.getState().deleteService(extra!);
check(
  'deleting a service keeps the way',
  store.getState().system.ways.some((w) => w.id === kc),
);
check('deleting a service keeps the other services', servicesOnWay(kc).length === 1);

// --- removing part of a way (the eraser deletes control points) ---
{
  fresh();
  const ec = store.getState().beginWay('road', 'straight');
  (
    [
      [-115.3, 36.1],
      [-115.2, 36.1],
      [-115.1, 36.1],
      [-115.0, 36.1],
    ] as LngLat[]
  ).forEach((p) => store.getState().addWayPoint(ec, p));
  store.getState().finishWay();
  const before = store.getState().system.ways.find((w) => w.id === ec)!.points.length;
  store.getState().deleteWayPoint(ec, 1);
  const w = store.getState().system.ways.find((ww) => ww.id === ec)!;
  check('deleteWayPoint removes one control point', before === 4 && w.points.length === 3);
  check('the right control point was removed', w.points[1][0] === -115.1);
}

// --- geometry: straight vs curved on a way ---
{
  fresh();
  const g = store.getState().beginWay('lightRail', 'curved');
  store.getState().addWayPoint(g, [-115.2, 36.1]);
  store.getState().addWayPoint(g, [-115.16, 36.16]);
  store.getState().addWayPoint(g, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways.find((w) => w.id === g)!;
  const straight = resolveWayPath({ ...way, geometry: 'straight' });
  const curved = resolveWayPath({ ...way, geometry: 'curved' });
  check('curved way path is densified', curved.length > straight.length);
  check('way length > 0', wayLengthMeters(way) > 1000);
}

// --- rounded-corner curve: local support, no overshoot, exact endpoints ---
{
  const zig: LngLat[] = [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
  ];
  const curve = roundedCorners(zig, 0.25, 24);
  const ys = curve.map((p) => p[1]);
  const overshoot = Math.max(Math.max(...ys) - 1, 0 - Math.min(...ys));
  check(
    'curve starts and ends exactly at the first/last control point',
    curve[0][0] === zig[0][0] &&
      curve[0][1] === zig[0][1] &&
      curve[curve.length - 1][0] === zig[4][0],
  );
  check(`curve barely overshoots (${overshoot.toFixed(3)})`, overshoot < 0.15);
  const near = nearestOnPath(
    [
      [0, 0],
      [10, 0],
    ] as LngLat[],
    [5, 1] as LngLat,
  );
  check('nearestOnPath finds midpoint t≈0.5', !!near && Math.abs(near.t - 0.5) < 0.05);
}

// --- pointAtDistance (the vehicle sim's O(log n) position lookup) must produce
// the SAME coordinate as pointAtT for the equivalent distance: it's a faster
// path via precomputed arc lengths, not a different result. ---
{
  const path: LngLat[] = [
    [-115.2, 36.1],
    [-115.17, 36.13],
    [-115.1, 36.1],
    [-115.05, 36.2],
  ];
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];
  check(
    'cumulativeLengths total matches pathLengthMeters',
    Math.abs(total - pathLengthMeters(path)) < 1e-6,
  );
  check(
    'cumulativeLengths starts at 0 and is monotonic',
    cum[0] === 0 && cum.every((v, i) => i === 0 || v >= cum[i - 1]),
  );
  let maxDelta = 0;
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const viaT = pointAtT(path, t);
    const viaDist = pointAtDistance(path, cum, t * total);
    maxDelta = Math.max(maxDelta, Math.abs(viaT[0] - viaDist[0]), Math.abs(viaT[1] - viaDist[1]));
  }
  check(
    `pointAtDistance matches pointAtT across the path (max Δ ${maxDelta.toExponential(1)})`,
    maxDelta < 1e-9,
  );
  const start = pointAtDistance(path, cum, -100);
  const end = pointAtDistance(path, cum, total + 100);
  check(
    'pointAtDistance clamps before the start to the first point',
    start[0] === path[0][0] && start[1] === path[0][1],
  );
  check(
    'pointAtDistance clamps past the end to the last point',
    end[0] === path[path.length - 1][0] && end[1] === path[path.length - 1][1],
  );
}

// --- rounded-corner curve has strictly LOCAL support: moving a far-away
// control point must not reshape a corner it isn't adjacent to (this is
// exactly what a tangent-continuous spline like Catmull-Rom gets wrong — it
// leaks influence two segments out instead of one). ---
{
  const base: LngLat[] = [
    [0, 0],
    [1, 0.4],
    [2, 0],
    [3, 0.4],
    [4, 0],
    [5, 0.4],
    [6, 0],
  ];
  const moved: LngLat[] = base.map((p, i) => (i === 5 ? [p[0], p[1] + 2] : p)); // move point 5 far away
  const curveBase = roundedCorners(base, 0.25, 12);
  const curveMoved = roundedCorners(moved, 0.25, 12);
  // The fillet around point 1 (index 1) depends only on points 0,1,2 — none of
  // which changed — so the first ~1/3 of the curve must be byte-identical.
  const untouchedCount = Math.floor(curveBase.length / 3);
  let identical = true;
  for (let i = 0; i < untouchedCount; i++) {
    if (curveBase[i][0] !== curveMoved[i][0] || curveBase[i][1] !== curveMoved[i][1])
      identical = false;
  }
  check('moving a far control point leaves distant corners exactly unchanged', identical);
}

// --- a service's pattern can span ways of different, compatible types
// (tram: dedicated track + street-running road) ---
{
  const dedicated: Way = {
    id: 'w1',
    typeId: 'lightRail',
    points: [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('lightRail'),
  };
  const streetRunning: Way = {
    id: 'w2',
    typeId: 'road',
    points: [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    classId: 'transitway',
  };
  const spanningService: Service = {
    id: 'svc',
    name: 'Tram',
    modeId: 'tram',
    color: '#16a085',
    patterns: [{ id: 'p1', wayIds: ['w1', 'w2'] }],
  };
  const totalLength = wayLengthMeters(dedicated) + wayLengthMeters(streetRunning);
  check(
    "a service's pattern can span a dedicated way and a street-running road",
    serviceWayIds(spanningService).length === 2,
  );
  check('length sums correctly across mixed way types', totalLength > 0);
}

// --- fork ---
fresh();
{
  const fa = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(fa, [-115.2, 36.1]);
  store.getState().addWayPoint(fa, [-115.0, 36.1]);
  store.getState().finishWay();
}
sys = store.getState().system;
const forked = forkSystem(sys);
check('fork has new id + copy name', forked.id !== sys.id && forked.name.includes('(copy)'));

// --- parse: v3 round-trips ways/services/station anchor ---
{
  fresh();
  const pc = store.getState().beginWay('lightRail', 'curved');
  store.getState().addWayPoint(pc, [-115.2, 36.1]);
  store.getState().addWayPoint(pc, [-115.1, 36.15]);
  store.getState().finishWay();
  store.getState().addServiceToWay(pc);
  store.getState().addStation([-115.15, 36.12], { wayId: pc, t: 0.4 });
  const before = store.getState().system;
  const round = parseSystem(JSON.parse(JSON.stringify(before)));
  check('parse round-trips ways', round.ways.length === before.ways.length);
  check('parse round-trips services', round.services.length === 2);
  check('parse round-trips station anchor (wayId)', round.stations[0].anchor?.wayId === pc);
}

// --- migration: v2 corridors infer heavyRail/lightRail/monorail/road from the service mode ---
{
  const v2 = {
    version: 2,
    id: 'old2',
    name: 'V2 system',
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stations: [],
    corridors: [
      {
        id: 'c-subway',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
      },
      {
        id: 'c-tram',
        points: [
          [-115.2, 36.2],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
        grade: 'atGrade',
      },
      {
        id: 'c-mono',
        points: [
          [-115.2, 36.3],
          [-115.1, 36.3],
        ],
        geometry: 'straight',
        grade: 'elevated',
      },
    ],
    services: [
      { id: 'sv1', name: 'Red', mode: 'subway', color: '#c0392b', corridorIds: ['c-subway'] },
      { id: 'sv2', name: 'Green', mode: 'tram', color: '#16a085', corridorIds: ['c-tram'] },
      { id: 'sv3', name: 'Mono', mode: 'monorail', color: '#8b5cf6', corridorIds: ['c-mono'] },
    ],
    roads: [
      {
        id: 'r1',
        coords: [
          [-115.3, 36.1],
          [-115.25, 36.1],
        ],
        class: 'collector',
      },
    ],
  };
  const migrated = parseSystem(v2);
  const typeOf = (id: string) => migrated.ways.find((w) => w.id === id)?.typeId;
  check('v2 subway corridor migrates to heavyRail', typeOf('c-subway') === 'heavyRail');
  check('v2 tram corridor migrates to lightRail', typeOf('c-tram') === 'lightRail');
  check('v2 monorail corridor migrates to monorail', typeOf('c-mono') === 'monorail');
  check(
    'v2 road migrates to a road way with its class preserved',
    typeOf('r1') === 'road' && migrated.ways.find((w) => w.id === 'r1')?.classId === 'collector',
  );
  check(
    'migrated services carry modeId (not mode)',
    migrated.services.every((s) => typeof s.modeId === 'string'),
  );
}

// --- parse: legacy v1 (lines) migrates to a typed way + service ---
{
  const legacy = {
    version: 1,
    id: 'old',
    name: 'Legacy',
    viewport: { center: [-115.17, 36.13], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    stations: [{ id: 's1', coord: [-115.15, 36.12], anchor: { lineId: 'l1', t: 0.5 } }],
    lines: [
      {
        id: 'l1',
        name: 'Old Line',
        mode: 'lightRail',
        color: '#e4572e',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.15],
        ],
        geometry: 'curved',
      },
    ],
    roads: [],
  };
  const m = parseSystem(legacy);
  check('legacy line → one way', m.ways.length === 1 && m.ways[0].id === 'l1');
  check('legacy lightRail line → lightRail way type', m.ways[0].typeId === 'lightRail');
  check(
    'legacy line → one service on that way',
    m.services.length === 1 && m.services[0].patterns[0].wayIds[0] === 'l1',
  );
  check(
    'legacy service keeps color/name',
    m.services[0].color === '#e4572e' && m.services[0].name === 'Old Line',
  );
  check('legacy station anchor migrated lineId → wayId', m.stations[0].anchor?.wayId === 'l1');
}

// --- modes + grade (infrastructure vertical alignment) ---
{
  fresh();
  const gc = store.getState().beginWay('heavyRail', 'straight');
  store.getState().addWayPoint(gc, [-115.2, 36.1]);
  store.getState().addWayPoint(gc, [-115.0, 36.1]);
  store.getState().finishWay();
  const svc = store.getState().system.services.find((s) => serviceWayIds(s).includes(gc))!;
  check(
    'subway is a valid mode',
    svc.modeId === 'subway' || modesForWayType('heavyRail').some((m) => m.id === svc.modeId),
  );
  const way = () => store.getState().system.ways.find((w) => w.id === gc)!;
  check('way defaults to at grade', way().grade === 'atGrade');
  store.getState().setWayGrade(gc, 'underground');
  check('setWayGrade sets the grade', way().grade === 'underground');
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check('parse round-trips way grade', round.ways[0].grade === 'underground');
  const noGrade = parseSystem({
    version: 3,
    id: 'x',
    name: 'x',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      {
        id: 'w',
        typeId: 'lightRail',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
      },
    ],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  });
  check('parse defaults missing grade to at grade', noGrade.ways[0].grade === 'atGrade');
  check(
    "parse defaults missing capacity from the way type's catalog default",
    wayCapacity(noGrade.ways[0]) === wayType('lightRail').defaultCapacity,
  );
}

// --- P2: physical cross-sections — capacity fans a way into that many
// parallel lane/track features, Infrastructure-view only ---
{
  fresh();
  const road = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(road, [-115.2, 36.1]);
  store.getState().addWayPoint(road, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setWayCapacity(road, 4);
  check(
    'setWayCapacity updates the way',
    wayCapacity(store.getState().system.ways.find((w) => w.id === road)!) === 4,
  );
  store.getState().setWayCapacity(road, 0);
  check(
    'setWayCapacity clamps to a minimum of 1',
    wayCapacity(store.getState().system.ways.find((w) => w.id === road)!) === 1,
  );
  store.getState().setWayCapacity(road, 4);

  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  const infra = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
  });
  const roadFeatures = infra.ways.features.filter((f) => f.properties?.id === road);
  check('infrastructure view fans a 4-lane road into 4 offset features', roadFeatures.length === 4);
  const offsets = new Set(roadFeatures.map((f) => f.properties?.offset));
  check('each lane gets a distinct offset', offsets.size === 4);

  // Network view is service-focused — a bare road's infra line (unserved) is
  // hidden entirely, and a road's own infra line stays hidden even once
  // served (only the colored service line shows) — capacity never fans out.
  const net = buildFeatures(store.getState().system, null, [], { viewMode: 'network', ...filters });
  check(
    "network view hides a bare way's infra line regardless of capacity",
    net.ways.features.filter((f) => f.properties?.id === road).length === 0,
  );
  const svc = store.getState().addServiceToWay(road)!;
  const netServed = buildFeatures(store.getState().system, null, [], {
    viewMode: 'network',
    ...filters,
  });
  check(
    "network view keeps a served way's infra line hidden too",
    netServed.ways.features.filter((f) => f.properties?.id === road).length === 0,
  );
  check(
    'network view renders the service itself regardless of capacity',
    netServed.services.features.some((f) => f.properties?.serviceId === svc),
  );
}

// --- P3: station footprints & platforms ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  check(
    'station starts with no footprint',
    store.getState().system.stations[0].footprint === undefined,
  );
  store.getState().addStationFootprint(stId);
  const withFootprint = () => store.getState().system.stations.find((s) => s.id === stId)!;
  check(
    'addStationFootprint gives it a 4-corner default square',
    withFootprint().footprint?.length === 4,
  );
  const square = squareFootprint([-115.15, 36.1], 30);
  check(
    'squareFootprint is centered on its input coord',
    Math.abs((square[0][0] + square[2][0]) / 2 - -115.15) < 1e-9,
  );

  store.getState().moveFootprintPoint(stId, 0, [-115.1501, 36.1001]);
  check('moveFootprintPoint edits one corner', withFootprint().footprint![0][0] === -115.1501);

  const platformId = store.getState().addPlatform(stId);
  check(
    'addPlatform adds a platform to the station',
    withFootprint().platforms?.length === 1 && withFootprint().platforms![0].id === platformId,
  );
  store.getState().movePlatformPoint(stId, platformId, 1, [-115.14, 36.09]);
  check(
    'movePlatformPoint edits one platform corner',
    withFootprint().platforms![0].points[1][0] === -115.14,
  );
  store.getState().deletePlatform(stId, platformId);
  check('deletePlatform removes it', withFootprint().platforms?.length === 0);

  store.getState().deleteStationFootprint(stId);
  check(
    'deleteStationFootprint clears the footprint (and any platforms)',
    withFootprint().footprint === undefined,
  );
}

// --- P3: catalog-typed facilities ---
{
  fresh();
  const facId = store.getState().addFacility('bikeDock', [-115.16, 36.12]);
  check(
    'addFacility creates it and selects it',
    store.getState().system.facilities.length === 1 &&
      store.getState().selection?.kind === 'facility',
  );
  check(
    'facility keeps its catalog type',
    store.getState().system.facilities[0].typeId === 'bikeDock',
  );
  store.getState().moveFacility(facId, [-115.161, 36.121]);
  check(
    'moveFacility updates its geometry',
    (store.getState().system.facilities[0].geometry as LngLat)[0] === -115.161,
  );
  store.getState().setFacilityName(facId, 'Main entrance dock');
  check(
    'setFacilityName renames it',
    store.getState().system.facilities[0].name === 'Main entrance dock',
  );
  store.getState().deleteFacility(facId);
  check(
    'deleteFacility removes it and clears the selection',
    store.getState().system.facilities.length === 0 && store.getState().selection === null,
  );
}

// --- P3: grouping (station complexes / line families) ---
{
  fresh();
  const a = store.getState().addStation([-115.2, 36.1]);
  const b = store.getState().addStation([-115.2001, 36.1001]);
  const c = store.getState().addStation([-115.2002, 36.1002]);
  const groupId = store.getState().createGroup([a, b], 'Downtown complex');
  check(
    'createGroup bundles the given members',
    store.getState().system.groups[0].memberIds.length === 2,
  );
  store.getState().addGroupMember(groupId, c);
  check(
    'addGroupMember adds a third member',
    store.getState().system.groups[0].memberIds.includes(c),
  );
  store.getState().addGroupMember(groupId, c);
  check(
    'addGroupMember is idempotent (no duplicate)',
    store.getState().system.groups[0].memberIds.filter((m) => m === c).length === 1,
  );
  store.getState().removeGroupMember(groupId, b);
  check(
    'removeGroupMember removes just that member',
    !store.getState().system.groups[0].memberIds.includes(b) &&
      store.getState().system.groups[0].memberIds.includes(a),
  );
  store.getState().renameGroup(groupId, 'Renamed complex');
  check('renameGroup renames it', store.getState().system.groups[0].name === 'Renamed complex');
  store.getState().deleteGroup(groupId);
  check('deleteGroup removes it', store.getState().system.groups.length === 0);
}

// --- Facility complexes: draw-a-boundary-first editor (task 22) ---
{
  fresh();
  const drawnRing: LngLat[] = [
    [-115.19, 36.12],
    [-115.17, 36.12],
    [-115.17, 36.14],
    [-115.19, 36.14],
  ];
  const groupId = store.getState().createFacilityComplex(drawnRing);
  check(
    'createFacilityComplex creates a footprint-having group and selects it',
    store.getState().system.groups.length === 1 &&
      store.getState().selection?.kind === 'group' &&
      store.getState().selection?.id === groupId,
  );
  check(
    "the new complex's footprint is exactly the boundary that was drawn",
    store.getState().system.groups[0].footprint?.length === 4,
  );
  check(
    'the new complex starts with no members',
    store.getState().system.groups[0].memberIds.length === 0,
  );
  check(
    'createFacilityComplex assigns a color from the palette',
    !!store.getState().system.groups[0].color,
  );

  store.getState().moveGroupFootprintPoint(groupId, 0, [-115.1801, 36.1301]);
  check(
    'moveGroupFootprintPoint edits one corner',
    store.getState().system.groups[0].footprint![0][0] === -115.1801,
  );

  store.getState().startPlacingFacility(groupId);
  check(
    'startPlacingFacility arms placement and switches to the facility tool',
    store.getState().placingFacilityForGroupId === groupId && store.getState().tool === 'facility',
  );
  const facId = store.getState().placeFacilityInGroup(groupId, 'busBay', [-115.179, 36.129]);
  check(
    'placeFacilityInGroup creates the facility',
    store.getState().system.facilities.some((f) => f.id === facId && f.typeId === 'busBay'),
  );
  check(
    'placeFacilityInGroup joins it to the complex',
    store.getState().system.groups[0].memberIds.includes(facId),
  );
  check(
    'placeFacilityInGroup disarms placement and returns to select',
    store.getState().placingFacilityForGroupId === null && store.getState().tool === 'select',
  );
  check(
    'placeFacilityInGroup keeps the complex selected (not the new facility)',
    store.getState().selection?.kind === 'group' && store.getState().selection?.id === groupId,
  );

  const looseStation = store.getState().addStation([-115.181, 36.131]);
  store.getState().startPickingMember(groupId);
  check('startPickingMember arms picking', store.getState().pickingMemberForGroupId === groupId);
  store.getState().addGroupMember(groupId, looseStation);
  store.getState().cancelPickingMember();
  check(
    'picking flow (addGroupMember + cancel) adds the existing station and disarms',
    store.getState().system.groups[0].memberIds.includes(looseStation) &&
      store.getState().pickingMemberForGroupId === null,
  );

  store.getState().deleteGroupFootprint(groupId);
  check(
    'deleteGroupFootprint clears the footprint but keeps members',
    store.getState().system.groups[0].footprint === undefined &&
      store.getState().system.groups[0].memberIds.length === 2,
  );

  store.getState().addGroupFootprint(groupId);
  check(
    'addGroupFootprint re-adds a default footprint',
    store.getState().system.groups[0].footprint?.length === 4,
  );
}

// --- Plain (footprint-less) groups still work — a facility complex is an
// opt-in specialization, not a required shape for every group ---
{
  fresh();
  const a = store.getState().addStation([-115.2, 36.1]);
  const b = store.getState().addStation([-115.2001, 36.1001]);
  store.getState().createGroup([a, b], 'Transfer complex');
  check(
    'a plain group has no footprint',
    store.getState().system.groups[0].footprint === undefined,
  );
}

// --- On-map labels: name flows into station/facility feature properties ---
{
  fresh();
  const namedId = store.getState().addStation([-115.16, 36.12]);
  store.getState().setStationName(namedId, 'Downtown');
  const unnamedId = store.getState().addStation([-115.17, 36.13]);
  const facId = store.getState().addFacility('depot', [-115.18, 36.14]);
  store.getState().setFacilityName(facId, 'Maintenance Yard');
  const unnamedFacId = store.getState().addFacility('entrance', [-115.19, 36.15]);

  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set<string>(),
  };
  const net = buildFeatures(store.getState().system, null, [], view);
  const namedStationFeature = net.stations.features.find((f) => f.properties?.id === namedId);
  const unnamedStationFeature = net.stations.features.find((f) => f.properties?.id === unnamedId);
  check(
    "a named station's feature carries its name (network view too)",
    namedStationFeature?.properties?.name === 'Downtown',
  );
  check(
    "an unnamed station's feature has an empty-string name, not undefined",
    unnamedStationFeature?.properties?.name === '',
  );

  const infra = buildFeatures(store.getState().system, null, [], {
    ...view,
    viewMode: 'infrastructure',
  });
  const namedFacFeature = infra.facilities.features.find((f) => f.properties?.id === facId);
  const unnamedFacFeature = infra.facilities.features.find(
    (f) => f.properties?.id === unnamedFacId,
  );
  check(
    "a named facility's feature carries its name",
    namedFacFeature?.properties?.name === 'Maintenance Yard',
  );
  check(
    "an unnamed facility's feature has an empty-string name, not undefined",
    unnamedFacFeature?.properties?.name === '',
  );
}

// --- P3: footprints/platforms/facilities render in Infrastructure view only ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  store.getState().addStationFootprint(stId);
  store.getState().addPlatform(stId);
  store.getState().addFacility('entrance', [-115.151, 36.101]);
  // Empty way-type filter on purpose — footprints/platforms/facilities render
  // independent of way-type visibility, only gated by view mode.
  const emptyView = {
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set<string>(),
  };
  const infra = buildFeatures(
    store.getState().system,
    null,
    [],
    { viewMode: 'infrastructure', ...emptyView },
    stId,
  );
  check(
    'infrastructure view renders the footprint polygon',
    infra.footprints.features.length === 1,
  );
  check('infrastructure view renders the platform polygon', infra.platforms.features.length === 1);
  check('infrastructure view renders the facility point', infra.facilities.features.length === 1);
  check(
    "physicalHandleStationId renders that station's footprint+platform vertices",
    infra.physicalHandles.features.length === 4 + 4,
  );

  const net = buildFeatures(
    store.getState().system,
    null,
    [],
    { viewMode: 'network', ...emptyView },
    stId,
  );
  check('network view hides footprints', net.footprints.features.length === 0);
  check('network view hides platforms', net.platforms.features.length === 0);
  check('network view hides facilities', net.facilities.features.length === 0);
  check('network view hides physical handles too', net.physicalHandles.features.length === 0);

  const groupId = store.getState().createFacilityComplex([
    [-115.2, 36.13],
    [-115.18, 36.13],
    [-115.18, 36.15],
    [-115.2, 36.15],
  ]);
  const infraWithGroup = buildFeatures(
    store.getState().system,
    null,
    [],
    { viewMode: 'infrastructure', ...emptyView },
    null,
    groupId,
  );
  check(
    "infrastructure view renders a group's footprint polygon too",
    infraWithGroup.footprints.features.length === 2,
  ); // station's + group's
  check(
    "physicalHandleGroupId renders that group's footprint vertices",
    infraWithGroup.physicalHandles.features.length === 4,
  );
  const infraGroupUnselected = buildFeatures(
    store.getState().system,
    null,
    [],
    { viewMode: 'infrastructure', ...emptyView },
    null,
    null,
  );
  check(
    "a group's footprint still renders when it isn't the active handle owner",
    infraGroupUnselected.footprints.features.length === 2,
  );
  check(
    "but its handles don't, without physicalHandleGroupId",
    infraGroupUnselected.physicalHandles.features.length === 0,
  );
}

// --- P3: v3 serialize round-trips footprints, platforms, facilities, groups ---
{
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1]);
  store.getState().addStationFootprint(stId);
  store.getState().addPlatform(stId);
  store.getState().addFacility('depot', [-115.16, 36.11]);
  const other = store.getState().addStation([-115.17, 36.12]);
  store.getState().createGroup([stId, other], 'Complex');
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check(
    'parse round-trips a station footprint',
    round.stations.find((s) => s.id === stId)?.footprint?.length === 4,
  );
  check(
    'parse round-trips platforms',
    round.stations.find((s) => s.id === stId)?.platforms?.length === 1,
  );
  check(
    'parse round-trips facilities',
    round.facilities.length === 1 && round.facilities[0].typeId === 'depot',
  );
  check(
    'parse round-trips groups',
    round.groups.length === 1 && round.groups[0].memberIds.length === 2,
  );

  // A facility complex's footprint + color used to be silently dropped by
  // parseSystem (never read at all) — real data loss on save/reload.
  const complexId = store.getState().createFacilityComplex([
    [-115.2, 36.13],
    [-115.18, 36.13],
    [-115.18, 36.15],
    [-115.2, 36.15],
  ]);
  const roundComplex = parseSystem(JSON.parse(JSON.stringify(store.getState().system))).groups.find(
    (g) => g.id === complexId,
  );
  check("parse round-trips a facility complex's footprint", roundComplex?.footprint?.length === 4);
  check(
    "parse round-trips a facility complex's color",
    roundComplex?.color === store.getState().system.groups.find((g) => g.id === complexId)!.color,
  );
}

// --- Junction primitive: joinWayPointToWay forms a real shared-coordinate
// node, and every way-editing action keeps its refs in sync ---
{
  fresh();
  // Way A: a straight line the junction will land on mid-segment.
  const wA = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wA, [-115.2, 36.1]);
  store.getState().addWayPoint(wA, [-115.1, 36.1]);
  store.getState().finishWay();
  // Way B ends exactly where A's midpoint is — join them.
  const wB = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wB, [-115.15, 36.2]);
  store.getState().addWayPoint(wB, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wB, 1, wA, [-115.15, 36.1]);

  let s = store.getState().system;
  check(
    'joinWayPointToWay inserts a real control point into the target way',
    s.ways.find((w) => w.id === wA)!.points.length === 3,
  );
  check(
    'the inserted point lands at the join coordinate',
    s.ways.find((w) => w.id === wA)!.points[1][0] === -115.15,
  );
  check('exactly one node was created', s.nodes.length === 1);
  const node = s.nodes[0];
  check(
    "the node links both ways' points",
    node.refs.length === 2 &&
      node.refs.some((r) => r.wayId === wA) &&
      node.refs.some((r) => r.wayId === wB),
  );

  // Moving the junction (on EITHER way) must cascade to the other — the exact
  // bug the plan doc calls out ("junctions silently desync when you edit them").
  store.getState().moveWayPoint(wB, 1, [-115.16, 36.05]);
  s = store.getState().system;
  check(
    'moving the shared point on one way also moves it on the other (no desync)',
    s.ways.find((w) => w.id === wA)!.points[1][0] === -115.16 &&
      s.ways.find((w) => w.id === wB)!.points[1][0] === -115.16,
  );
  check("the node's own coord tracks the cascaded move too", s.nodes[0].coord[0] === -115.16);

  // Inserting a point earlier in way A must shift the node's ref index, not
  // leave it pointing at the wrong (now-shifted) point.
  store.getState().insertWayPoint(wA, 0, [-115.22, 36.09]);
  s = store.getState().system;
  const wARef = s.nodes[0].refs.find((r) => r.wayId === wA)!;
  check("insertWayPoint shifts the node's ref index on that way", wARef.pointIndex === 2);
  check(
    'the ref still points at the actual junction point after the shift',
    s.ways.find((w) => w.id === wA)!.points[wARef.pointIndex][0] === -115.16,
  );

  // Deleting the OTHER end of way A (not the junction point) must not disturb
  // the node's ref into way A, only reindex it.
  store.getState().deleteWayPoint(wA, 0);
  s = store.getState().system;
  const wARef2 = s.nodes[0].refs.find((r) => r.wayId === wA)!;
  check("deleteWayPoint before the node's index shifts it back down", wARef2.pointIndex === 1);
  check('node survives an unrelated point deletion', s.nodes.length === 1);

  // Deleting the junction's OWN point on one way should drop that way's ref
  // and, since only one ref remains, the node stops being a junction at all.
  const wBRefIndex = s.nodes[0].refs.find((r) => r.wayId === wB)!.pointIndex;
  store.getState().deleteWayPoint(wB, wBRefIndex);
  s = store.getState().system;
  check(
    'deleting the shared point on one way drops the node (no longer a real junction)',
    s.nodes.length === 0,
  );

  // deleteWay must strip any surviving refs to the removed way.
  fresh();
  const wC = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wC, [-115.2, 36.1]);
  store.getState().addWayPoint(wC, [-115.1, 36.1]);
  store.getState().finishWay();
  const wD = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wD, [-115.15, 36.2]);
  store.getState().addWayPoint(wD, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wD, 1, wC, [-115.15, 36.1]);
  check('setup: node exists before delete', store.getState().system.nodes.length === 1);
  store.getState().deleteWay(wC);
  check(
    'deleteWay removes the node once its junction partner is gone',
    store.getState().system.nodes.length === 0,
  );

  // v3→v4 migration derives nodes from raw coordinate coincidence when a
  // loaded system has no explicit nodes field.
  const legacyRound = parseSystem({
    version: 3,
    id: 'x',
    name: 'x',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      {
        id: 'p',
        typeId: 'lightRail',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
      },
      {
        id: 'q',
        typeId: 'lightRail',
        points: [
          [-115.1, 36.1],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
      },
    ],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  });
  check(
    'migrated v3 data derives a node from coincident way endpoints',
    legacyRound.nodes.length === 1 && legacyRound.nodes[0].refs.length === 2,
  );

  // A system round-tripped through JSON keeps its explicit v4 nodes intact.
  fresh();
  const wE = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wE, [-115.2, 36.1]);
  store.getState().addWayPoint(wE, [-115.1, 36.1]);
  store.getState().finishWay();
  const wF = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wF, [-115.15, 36.2]);
  store.getState().addWayPoint(wF, [-115.15, 36.1]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wF, 1, wE, [-115.15, 36.1]);
  const v4Round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  check(
    'v4 round-trip preserves the explicit node',
    v4Round.nodes.length === 1 && v4Round.nodes[0].refs.length === 2,
  );
}

// --- multi-select: toggle, bulk move (nudge), bulk delete ---
{
  fresh();
  const wayA = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wayA, [-115.2, 36.1]);
  store.getState().addWayPoint(wayA, [-115.1, 36.1]);
  store.getState().finishWay();
  const stId = store.getState().addStation([-115.25, 36.05]); // free-floating, not anchored to wayA
  const facId = store.getState().addFacility('entrance', [-115.15, 36.2]);

  store.getState().toggleMultiSelect({ kind: 'way', id: wayA });
  store.getState().toggleMultiSelect({ kind: 'station', id: stId });
  check('toggleMultiSelect builds up the group', store.getState().multiSelection.length === 2);
  check('multi-select clears the single Inspector selection', store.getState().selection === null);

  store.getState().toggleMultiSelect({ kind: 'station', id: stId });
  check(
    'toggling an already-selected item removes it',
    store.getState().multiSelection.length === 1,
  );
  store.getState().toggleMultiSelect({ kind: 'station', id: stId });
  store.getState().toggleMultiSelect({ kind: 'facility', id: facId });
  check('group now has all 3 kinds', store.getState().multiSelection.length === 3);

  const before = store.getState().system;
  store.getState().nudgeMultiSelection(0.01, 0.02);
  let s = store.getState().system;
  check(
    'nudge moves every point of a selected way',
    s.ways.find((w) => w.id === wayA)!.points[0][0] ===
      before.ways.find((w) => w.id === wayA)!.points[0][0] + 0.01,
  );
  check(
    'nudge moves a selected free-floating station',
    s.stations.find((st) => st.id === stId)!.coord[0] ===
      before.stations.find((st) => st.id === stId)!.coord[0] + 0.01,
  );
  check(
    "nudge moves a selected facility's point geometry",
    (s.facilities.find((f) => f.id === facId)!.geometry as [number, number])[1] ===
      (before.facilities.find((f) => f.id === facId)!.geometry as [number, number])[1] + 0.02,
  );

  // A station anchored to a way that's ALSO in the group must not be
  // double-moved — it already follows via the way's own reanchor.
  const anchoredSt = store.getState().addStation([-115.15, 36.1], { wayId: wayA, t: 0.5 });
  store.getState().toggleMultiSelect({ kind: 'station', id: anchoredSt });
  const wayPointBefore = store.getState().system.ways.find((w) => w.id === wayA)!.points[0];
  store.getState().nudgeMultiSelection(0.005, 0.005);
  s = store.getState().system;
  const expectedCoord = pointAtT(resolveWayPath(s.ways.find((w) => w.id === wayA)!), 0.5);
  const actualCoord = s.stations.find((st) => st.id === anchoredSt)!.coord;
  check(
    "a station anchored to a co-selected way follows the way's own reanchor, not a second direct nudge",
    Math.abs(actualCoord[0] - expectedCoord[0]) < 1e-9 &&
      Math.abs(actualCoord[1] - expectedCoord[1]) < 1e-9,
  );
  check(
    'the way itself did move',
    s.ways.find((w) => w.id === wayA)!.points[0][0] !== wayPointBefore[0],
  );

  check(
    'group still has 4 members before bulk delete',
    store.getState().multiSelection.length === 4,
  );
  store.getState().deleteMultiSelection();
  s = store.getState().system;
  check('bulk delete removes the way', !s.ways.some((w) => w.id === wayA));
  check(
    'bulk delete removes both stations',
    !s.stations.some((st) => st.id === stId || st.id === anchoredSt),
  );
  check('bulk delete removes the facility', !s.facilities.some((f) => f.id === facId));
  check('bulk delete clears the group', store.getState().multiSelection.length === 0);
}

// --- multi-way group-drag: nudging 2+ selected ways in one batch reanchors
// each station against its OWN anchor way, not another way in the same
// batch (updateWayPointsBatch) ---
{
  fresh();
  const wayA = store.getState().beginWay('lightRail', 'straight'); // E-W
  store.getState().addWayPoint(wayA, [-115.2, 36.1]);
  store.getState().addWayPoint(wayA, [-115.1, 36.1]);
  store.getState().finishWay();
  const wayB = store.getState().beginWay('lightRail', 'straight'); // N-S, a different
  store.getState().addWayPoint(wayB, [-115.3, 36.3]); // shape/orientation than wayA, so
  store.getState().addWayPoint(wayB, [-115.3, 36.0]); // reanchoring against the wrong way
  store.getState().finishWay(); // in the batch would be numerically obvious.
  const stOnA = store.getState().addStation([-115.15, 36.1], { wayId: wayA, t: 0.5 });

  store.getState().toggleMultiSelect({ kind: 'way', id: wayA });
  store.getState().toggleMultiSelect({ kind: 'way', id: wayB });
  check('both ways are in the group', store.getState().multiSelection.length === 2);

  const before = store.getState().system;
  store.getState().nudgeMultiSelection(0.02, -0.03);
  const s = store.getState().system;
  const newWayA = s.ways.find((w) => w.id === wayA)!;
  const newWayB = s.ways.find((w) => w.id === wayB)!;
  check(
    'wayA moved by the nudge delta',
    newWayA.points[0][0] === before.ways.find((w) => w.id === wayA)!.points[0][0] + 0.02,
  );
  check(
    'wayB moved by the nudge delta too',
    newWayB.points[0][1] === before.ways.find((w) => w.id === wayB)!.points[0][1] - 0.03,
  );

  const expectedOnA = pointAtT(resolveWayPath(newWayA), 0.5);
  const wrongOnB = pointAtT(resolveWayPath(newWayB), 0.5);
  const actual = s.stations.find((st) => st.id === stOnA)!.coord;
  check(
    "a station anchored to one way in a multi-way batch follows THAT way's new path",
    Math.abs(actual[0] - expectedOnA[0]) < 1e-9 && Math.abs(actual[1] - expectedOnA[1]) < 1e-9,
  );
  check(
    "…not the other selected way's path (they're shaped differently enough to tell apart)",
    Math.abs(actual[0] - wrongOnB[0]) > 1e-6 || Math.abs(actual[1] - wrongOnB[1]) > 1e-6,
  );
}

// --- splitWayAt: splits infrastructure, keeps riding services whole,
// re-snaps stations, and links the split point as a real junction ---
{
  fresh();
  const trunk = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(trunk, [-115.3, 36.1]);
  store.getState().addWayPoint(trunk, [-115.2, 36.1]);
  store.getState().addWayPoint(trunk, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setWayGrade(trunk, 'underground');
  const svc = store.getState().system.services.find((sv) => serviceWayIds(sv).includes(trunk))!.id;
  // A station riding each half, so the re-snap can be checked on both sides.
  const westStop = store.getState().addStation([-115.25, 36.1], { wayId: trunk, t: 0.25 });
  const eastStop = store.getState().addStation([-115.15, 36.1], { wayId: trunk, t: 0.75 });

  store.getState().splitWayAt(trunk, 1); // split at the middle control point
  let s = store.getState().system;
  check('splitWayAt produces exactly one new way', s.ways.length === 2);
  const wayA = s.ways.find((w) => w.id === trunk)!;
  const wayB = s.ways.find((w) => w.id !== trunk)!;
  check('the first half keeps the original id and its first 2 points', wayA.points.length === 2);
  check('the second half gets a new id with the remaining 2 points', wayB.points.length === 2);
  check(
    'the second half inherits grade/type from the original',
    wayB.grade === 'underground' && wayB.typeId === 'lightRail',
  );

  const service = s.services.find((sv) => sv.id === svc)!;
  const svcWayIds = service.patterns[0].wayIds;
  check(
    "the riding service's pattern now runs over both halves, in order",
    svcWayIds.length === 2 && svcWayIds[0] === trunk && svcWayIds[1] === wayB.id,
  );

  check(
    'the split point becomes a real junction node',
    s.nodes.some(
      (n) =>
        n.refs.length === 2 &&
        n.refs.some((r) => r.wayId === trunk) &&
        n.refs.some((r) => r.wayId === wayB.id),
    ),
  );

  const west = s.stations.find((st) => st.id === westStop)!;
  const east = s.stations.find((st) => st.id === eastStop)!;
  check('a station west of the split re-snaps onto the first half', west.anchor?.wayId === trunk);
  check(
    'a station east of the split re-snaps onto the second half',
    east.anchor?.wayId === wayB.id,
  );

  // Moving the shared split point still cascades to both halves (it's a
  // real Node now, not just two ways that happen to touch).
  store.getState().moveWayPoint(trunk, 1, [-115.2, 36.05]);
  s = store.getState().system;
  check(
    'the split point still cascades on move, like any other junction',
    s.ways.find((w) => w.id === trunk)!.points[1][1] === 36.05 &&
      s.ways.find((w) => w.id === wayB.id)!.points[0][1] === 36.05,
  );

  // Splitting at an endpoint (nothing to split off) is a documented no-op.
  fresh();
  const short = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(short, [-115.2, 36.1]);
  store.getState().addWayPoint(short, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(short, 0);
  check('splitting at an endpoint is a no-op', store.getState().system.ways.length === 1);
}

// --- Service frequency + span: additive fields, round-trip through parse ---
{
  fresh();
  const wayId = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.1]);
  store.getState().finishWay();
  const svcId = store.getState().system.services[0].id;
  // A fresh line now seeds a sensible default headway (see store.ts's
  // DEFAULT_FREQUENCY_MINUTES) instead of starting unset.
  check(
    'frequency starts at the default headway',
    store.getState().system.services[0].frequencyMinutes === 10,
  );
  store.getState().setServiceFrequency(svcId, 8);
  store.getState().setServiceSpan(svcId, '05:00', '01:00');
  let svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check('setServiceFrequency sets the peak headway', svc.frequencyMinutes === 8);
  check('setServiceSpan sets start/end', svc.spanStart === '05:00' && svc.spanEnd === '01:00');
  const round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
  svc = round.services.find((s) => s.id === svcId)!;
  check(
    'frequency/span round-trip through parse',
    svc.frequencyMinutes === 8 && svc.spanStart === '05:00' && svc.spanEnd === '01:00',
  );
  store.getState().setServiceFrequency(svcId, undefined);
  check(
    'frequency can be cleared back to unset',
    store.getState().system.services.find((s) => s.id === svcId)!.frequencyMinutes === undefined,
  );
}

// --- service patterns/branches: a service can have 2+ paths sharing one
// identity, drawn via startAddingPattern/finishWay, rendered as one shared
// line on a common trunk and separate lines past the branch point ---
{
  fresh();
  const trunk = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(trunk, [-115.3, 36.1]);
  store.getState().addWayPoint(trunk, [-115.1, 36.1]);
  store.getState().finishWay();
  const svcId = store
    .getState()
    .system.services.find((sv) => serviceWayIds(sv).includes(trunk))!.id;
  check(
    'service starts with exactly one pattern',
    store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 1,
  );

  store.getState().startAddingPattern(svcId);
  check(
    'startAddingPattern arms the flag and switches to the way tool',
    store.getState().addingPatternForServiceId === svcId && store.getState().tool === 'way',
  );

  // Draw a fresh way for the branch — it should NOT spawn its own service.
  const branchWay = store.getState().beginWay('lightRail', 'straight');
  check(
    'drawing while armed creates no second service',
    store.getState().system.services.length === 1,
  );
  store.getState().addWayPoint(branchWay, [-115.2, 36.1]);
  store.getState().addWayPoint(branchWay, [-115.15, 36.2]);
  store.getState().finishWay();

  let svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check(
    'finishing the draw attaches a second pattern on the same service',
    svc.patterns.length === 2,
  );
  check('the new pattern rides the branch way', svc.patterns[1].wayIds.includes(branchWay));
  check(
    'finishWay disarms addingPatternForServiceId',
    store.getState().addingPatternForServiceId === null,
  );
  check(
    'still exactly one service (a branch, not a new line)',
    store.getState().system.services.length === 1,
  );

  // Rendering: the shared trunk way carries this ONE service once, not twice,
  // even though both patterns technically "include" it via serviceWayIds.
  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(['lightRail']),
  };
  const fc = buildFeatures(store.getState().system, null, [], view);
  const trunkFeatures = fc.services.features.filter(
    (f) => (f.properties as { wayId: string }).wayId === trunk,
  );
  check(
    'the shared trunk renders as exactly one service line, not doubled by the branch',
    trunkFeatures.length === 1,
  );
  const branchFeatures = fc.services.features.filter(
    (f) => (f.properties as { wayId: string }).wayId === branchWay,
  );
  check('the branch-only way renders its own service line too', branchFeatures.length === 1);

  // Cancel: no-op on the model, just clears the flag.
  store.getState().startAddingPattern(svcId);
  store.getState().cancelAddingPattern();
  check(
    'cancelAddingPattern clears the flag without adding a pattern',
    store.getState().addingPatternForServiceId === null &&
      store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 2,
  );

  // deletePattern: no-op with only 1 pattern left, real otherwise.
  const onlyPatternId = store.getState().system.services.find((s) => s.id === svcId)!.patterns[0]
    .id;
  store
    .getState()
    .deletePattern(
      svcId,
      store.getState().system.services.find((s) => s.id === svcId)!.patterns[1].id,
    );
  svc = store.getState().system.services.find((s) => s.id === svcId)!;
  check(
    'deletePattern removes a branch when 2+ patterns exist',
    svc.patterns.length === 1 && svc.patterns[0].id === onlyPatternId,
  );
  store.getState().deletePattern(svcId, onlyPatternId);
  check(
    "deletePattern refuses to remove a service's last pattern",
    store.getState().system.services.find((s) => s.id === svcId)!.patterns.length === 1,
  );

  // v4-shape (flat wayIds, no patterns) migrates into one pattern.
  const legacyV4 = parseSystem({
    version: 4,
    id: 'x',
    name: 'x',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      {
        id: 'w',
        typeId: 'lightRail',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
      },
    ],
    services: [{ id: 's1', name: 'Old', modeId: 'lightRail', color: '#e4572e', wayIds: ['w'] }],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
  });
  check(
    'a v4 flat-wayIds service migrates into a single pattern',
    legacyV4.services[0].patterns.length === 1 &&
      legacyV4.services[0].patterns[0].wayIds[0] === 'w',
  );

  // A service with zero patterns is a ghost, same as the old empty-wayIds case.
  fresh();
  const ghostWay = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(ghostWay, [-115.2, 36.1]);
  store.getState().addWayPoint(ghostWay, [-115.1, 36.1]);
  store.getState().finishWay();
  const ghostSvcId = store.getState().system.services[0].id;
  store.getState().deleteWay(ghostWay); // drops the way, and with it the service's only pattern
  check(
    'removeWay drops a now-patternless service entirely',
    !store.getState().system.services.some((s) => s.id === ghostSvcId),
  );
}

// --- validateSystem: ghost records + crossing-without-joining ---
{
  fresh();
  check('a clean fresh system has no issues', validateSystem(store.getState().system).length === 0);

  // A way with fewer than 2 points is a ghost: accepted, invisible. finishWay
  // already discards a way that's still sub-2-point at draw time (see
  // store.ts), so the only way one exists is a finished way later shrunk by
  // deleteWayPoint (e.g. Alt-click erasing down to one point).
  fresh();
  const ghostWay = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(ghostWay, [-115.2, 36.1]);
  store.getState().addWayPoint(ghostWay, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().deleteWayPoint(ghostWay, 0);
  let issues = validateSystem(store.getState().system);
  check(
    'flags a sub-2-point way',
    issues.some((i) => i.id === `ghost-way-${ghostWay}`),
  );

  // An orphaned station: anchor points at a way id that doesn't exist.
  fresh();
  const stId = store.getState().addStation([-115.15, 36.1], { wayId: 'nonexistent', t: 0.5 });
  issues = validateSystem(store.getState().system);
  check(
    'flags a station anchored to a missing way',
    issues.some((i) => i.id === `orphan-station-${stId}`),
  );

  // Two ways that genuinely cross without joining should be flagged; the
  // same two, once joined via a Node, should not be. Built via importWays —
  // drawing them would auto-form the junction at finishWay now, leaving no
  // unjoined crossing to flag.
  fresh();
  const wX = 'vx';
  const wY = 'vy';
  store.getState().importWays({
    ways: [
      {
        id: wX,
        typeId: 'lightRail',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('lightRail'),
      },
      {
        id: wY,
        typeId: 'lightRail',
        points: [
          [-115.15, 36.05],
          [-115.15, 36.15],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('lightRail'),
      },
    ],
    nodes: [],
    namedWays: [],
    medians: [],
    turnRestrictions: [],
  });
  issues = validateSystem(store.getState().system);
  check(
    'flags two ways that cross without joining',
    issues.some((i) => i.id.startsWith('crossing-')),
  );

  store.getState().joinWayPointToWay(wY, 1, wX, [-115.15, 36.1]);
  issues = validateSystem(store.getState().system);
  check(
    'does not flag a crossing once the two ways share a real junction',
    !issues.some((i) => i.id.startsWith('crossing-')),
  );

  // Parallel ways that never cross at all: no false positive.
  fresh();
  const wP = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wP, [-115.2, 36.1]);
  store.getState().addWayPoint(wP, [-115.1, 36.1]);
  store.getState().finishWay();
  const wQ = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wQ, [-115.2, 36.11]);
  store.getState().addWayPoint(wQ, [-115.1, 36.11]);
  store.getState().finishWay();
  check(
    'parallel, non-crossing ways raise no crossing issue',
    !validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-')),
  );
}

// --- Capital cost-per-mile: a labeled range, not a fake-precise figure ---
{
  fresh();
  check('formatUsdCompact renders billions', formatUsdCompact(1_250_000_000) === '$1.3B');
  check('formatUsdCompact renders millions', formatUsdCompact(45_000_000) === '$45M');
  check(
    'formatUsdCompact renders sub-10M millions with one decimal',
    formatUsdCompact(4_500_000) === '$4.5M',
  );
  check('formatUsdCompact renders thousands', formatUsdCompact(2_500) === '$3K');

  const heavy = store.getState().beginWay('heavyRail', 'straight');
  store.getState().addWayPoint(heavy, [-115.2, 36.1]);
  store.getState().addWayPoint(heavy, [-115.1, 36.1]); // ~9.2km ≈ 5.7mi at this latitude
  store.getState().finishWay();
  store.getState().setWayGrade(heavy, 'underground');
  const heavyWay = store.getState().system.ways.find((w) => w.id === heavy)!;
  const heavyCost = estimateWayCapitalCost(heavyWay);
  check('underground heavy rail gets a cost estimate', heavyCost !== null);
  check(
    'cost total scales with length (low < high)',
    heavyCost !== null && heavyCost.totalLowUsd < heavyCost.totalHighUsd,
  );
  check(
    'total roughly equals per-mile rate × way length',
    heavyCost !== null &&
      Math.abs(
        heavyCost.totalLowUsd - heavyCost.perMileLowUsd * (wayLengthMeters(heavyWay) / 1609.344),
      ) < 1,
  );

  const ferry = store.getState().beginWay('water', 'straight');
  store.getState().addWayPoint(ferry, [-115.2, 36.1]);
  store.getState().addWayPoint(ferry, [-115.1, 36.1]);
  store.getState().finishWay();
  check(
    'a ferry route (no linear right-of-way cost concept) gets no estimate, not a misleading number',
    estimateWayCapitalCost(store.getState().system.ways.find((w) => w.id === ferry)!) === null,
  );
}

// --- Export: systemBounds + legend entries (the "full-system export" fix) ---
{
  fresh();
  check('systemBounds is null for an empty system', systemBounds(store.getState().system) === null);

  const wayId = store.getState().beginWay('heavyRail', 'straight');
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.2]);
  store.getState().finishWay();
  const stId = store.getState().addStation([-115.25, 36.05]);
  store.getState().addStationFootprint(stId); // extends the bbox further southwest
  const facId = store.getState().addFacility('depot', [-115.05, 36.25]); // extends northeast

  const bounds = systemBounds(store.getState().system);
  check('systemBounds returns [sw, ne]', bounds !== null);
  if (bounds) {
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    check(
      "systemBounds' west/south edge is west/south of every point",
      minLng < -115.25 && minLat < 36.05,
    );
    check(
      "systemBounds' east/north edge is east/north of every point",
      maxLng >= -115.05 && maxLat >= 36.25,
    );
  }
  store.getState().deleteFacility(facId);

  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set(['heavyRail']),
  };
  const expectedName = store.getState().system.services[0]?.name;
  const legend = legendEntriesFor(store.getState().system, view);
  check(
    'legendEntriesFor lists one entry per visible service',
    legend.length === 1 && legend[0].label === expectedName,
  );
  const hiddenModeView = { ...view, visibleModes: new Set<string>() };
  check(
    'legendEntriesFor respects the mode filter',
    legendEntriesFor(store.getState().system, hiddenModeView).length === 0,
  );
}

// --- P4: OSM import — pure, network-free transforms ---
{
  check(
    'classifyOsmWay maps railway=rail to heavyRail',
    classifyOsmWay({ railway: 'rail' })?.typeId === 'heavyRail',
  );
  check(
    'classifyOsmWay maps railway=subway to heavyRail too (same track standard)',
    classifyOsmWay({ railway: 'subway' })?.typeId === 'heavyRail',
  );
  check(
    'classifyOsmWay maps railway=tram to lightRail',
    classifyOsmWay({ railway: 'tram' })?.typeId === 'lightRail',
  );
  const primaryRoad = classifyOsmWay({ highway: 'primary' });
  check(
    'classifyOsmWay maps highway=primary to a road with arterial class',
    primaryRoad?.typeId === 'road' && primaryRoad.classId === 'arterial',
  );
  check(
    'classifyOsmWay maps highway=cycleway to bike',
    classifyOsmWay({ highway: 'cycleway' })?.typeId === 'bike',
  );
  check(
    'classifyOsmWay returns null for an uninteresting tag set',
    classifyOsmWay({ building: 'yes' }) === null,
  );
  check('classifyOsmWay returns null with no tags at all', classifyOsmWay(undefined) === null);

  const query = buildOverpassQuery({ west: -115.3, south: 36.0, east: -115.0, north: 36.2 }, [
    'road',
    'lightRail',
  ]);
  check('buildOverpassQuery embeds the bounding box', query.includes('36,-115.3,36.2,-115'));
  check(
    'buildOverpassQuery only includes requested categories',
    query.includes('highway') &&
      query.includes('light_rail') &&
      !query.includes('"railway"~"^(rail|subway)$"'),
  );

  // Annotated rather than inferred: mixing tag shapes across the array makes
  // tsc widen each `tags` to a union with optional-undefined members, which
  // doesn't satisfy OsmWayElement's Record<string, string>.
  const elements: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.11, lon: -115.19 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { railway: 'tram' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.12, lon: -115.18 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { building: 'yes' },
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.11, lon: -115.19 },
      ],
    }, // filtered out
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential' },
      geometry: [{ lat: 36.1, lon: -115.2 }],
    }, // filtered out: single point
    { type: 'node', id: 5, tags: { highway: 'residential' } }, // filtered out: not a way
  ];
  const ways = osmElementsToWays(elements);
  check('osmElementsToWays keeps only recognized, ≥2-point ways', ways.length === 2);
  check(
    'osmElementsToWays tags each way with its OSM source',
    ways.every((w) => w.source?.startsWith('osm:')),
  );
  check(
    'osmElementsToWays preserves [lon,lat] → LngLat point order',
    ways[0].points[0][0] === -115.2 && ways[0].points[0][1] === 36.1,
  );
  check(
    'osmElementsToWays assigns the residential road its local class',
    ways[0].typeId === 'road' && ways[0].classId === 'local',
  );
  check(
    "osmElementsToWays defaults capacity from the way type's catalog default",
    wayCapacity(ways[1]) === wayType('lightRail').defaultCapacity,
  );
  check(
    'osmElementsToWays yields no junctions when elements carry no node ids',
    osmElementsToNetwork(elements).nodes.length === 0,
  );
}

// --- P4: OSM import reads OSM's own lane tagging, not the type default ---
{
  const lanesOf = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.filter((l) => laneKind(l.kindId).role === 'travel' && l.kindId !== 'sidewalk');
  const dirs = (p: ReturnType<typeof profileFromOsmTags>) =>
    lanesOf(p)
      .map((l) => l.direction)
      .join(',');
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    lanesOf(p)
      .map((l) => l.kindId)
      .join(',');

  // The complaint that motivated this: a one-way carriageway imported as a
  // two-way street, so a divided road drew two yellow centre lines.
  const oneWay = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    oneway: 'yes',
    lanes: '3',
  });
  check('oneway=yes imports as a one-way profile', isOneWay(oneWay));
  check('oneway=yes honours the lanes count', lanesOf(oneWay).length === 3);
  check('oneway=yes runs every lane forward', dirs(oneWay) === 'forward,forward,forward');

  const reverseOneWay = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    oneway: '-1',
    lanes: '2',
  });
  check("oneway=-1 runs against the way's direction", dirs(reverseOneWay) === 'backward,backward');

  // A two-way street splits per OSM, not evenly, when OSM says so.
  const split = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    lanes: '5',
    'lanes:forward': '3',
    'lanes:backward': '2',
  });
  check(
    'lanes:forward/backward drive the split',
    dirs(split) === 'backward,backward,forward,forward,forward',
  );

  const inferred = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    lanes: '4',
    'lanes:backward': '1',
  });
  check(
    'a directional tag on one side infers the other from lanes',
    dirs(inferred) === 'backward,forward,forward,forward',
  );

  // lanes counts the shared centre lane, so it must not also become a travel lane.
  const centre = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    lanes: '5',
    'lanes:both_ways': '1',
  });
  check(
    'lanes:both_ways becomes a centre turn pocket',
    kinds(centre) === 'drive,drive,turnPocket,drive,drive',
  );

  // turn:lanes, left-to-right as the driver sees them.
  const turns = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    oneway: 'yes',
    lanes: '4',
    'turn:lanes': 'left|through|through|right',
  });
  check(
    'turn:lanes marks turn-only lanes as pockets',
    kinds(turns) === 'turnPocket,drive,drive,turnPocket',
  );

  const combo = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    oneway: 'yes',
    lanes: '2',
    'turn:lanes': 'through;right|right',
  });
  check('a through;right lane stays a travel lane', kinds(combo) === 'drive,turnPocket');

  const mismatched = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    oneway: 'yes',
    lanes: '3',
    'turn:lanes': 'left|through',
  });
  check(
    "a turn:lanes count that doesn't match the lanes is ignored",
    kinds(mismatched) === 'drive,drive,drive',
  );

  // Backward lanes are stored left-to-right facing forward, so the driver's
  // left is the rightmost of them — the entry order maps on reversed.
  const backTurns = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    lanes: '4',
    'lanes:forward': '2',
    'lanes:backward': '2',
    'turn:lanes:backward': 'left|through',
  });
  check(
    'turn:lanes:backward maps on reversed',
    kinds(backTurns) === 'drive,turnPocket,drive,drive',
  );

  // Class-aware fallback: without a lanes tag a local street is not an arterial.
  const local = profileFromOsmTags('road', 'local', { highway: 'residential' });
  const arterial = profileFromOsmTags('road', 'arterial', { highway: 'primary' });
  check('an untagged local street falls back to two lanes', lanesOf(local).length === 2);
  check('an untagged arterial still falls back to four', lanesOf(arterial).length === 4);
  check(
    "an untagged one-way street takes one carriageway's worth",
    lanesOf(profileFromOsmTags('road', 'arterial', { highway: 'primary', oneway: 'yes' }))
      .length === 2,
  );

  // Sidewalks OSM says aren't there shouldn't be invented.
  const sw = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.filter((l) => l.kindId === 'sidewalk').length;
  check(
    "the catalog's sidewalks stay when OSM is silent",
    sw(profileFromOsmTags('road', 'arterial', { highway: 'primary' })) === 2,
  );
  check(
    'sidewalk:left=no drops one side',
    sw(profileFromOsmTags('road', 'arterial', { highway: 'primary', 'sidewalk:left': 'no' })) === 1,
  );
  check(
    'sidewalk=no drops both',
    sw(profileFromOsmTags('road', 'arterial', { highway: 'primary', sidewalk: 'no' })) === 0,
  );
  check(
    'sidewalk:right=separate drops the side mapped elsewhere',
    sw(
      profileFromOsmTags('road', 'arterial', { highway: 'primary', 'sidewalk:right': 'separate' }),
    ) === 1,
  );

  // Hostile / malformed values fall back rather than allocating.
  check(
    'a non-numeric lanes tag falls back to the class default',
    lanesOf(profileFromOsmTags('road', 'local', { highway: 'residential', lanes: 'lots' }))
      .length === 2,
  );
  check(
    'an absurd lanes tag is clamped',
    lanesOf(profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '1e999' }))
      .length <= MAX_PRIMARY_LANES,
  );
  // Each tag clamps on its own, so the TOTAL is what needs holding: two
  // clamped directional tags used to allocate 64 lanes between them.
  const bothAbsurd = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    'lanes:forward': '999',
    'lanes:backward': '999',
  });
  check(
    'two absurd directional tags are clamped in total, not each',
    lanesOf(bothAbsurd).length <= MAX_PRIMARY_LANES,
  );
  check(
    'clamping an over-large split keeps both directions',
    new Set(lanesOf(bothAbsurd).map((l) => l.direction)).size === 2,
  );
  const absurdWithCentre = profileFromOsmTags('road', 'arterial', {
    highway: 'primary',
    'lanes:forward': '999',
    'lanes:backward': '999',
    'lanes:both_ways': '1',
  });
  check(
    'the centre turn lane counts against the ceiling too',
    absurdWithCentre.lanes.filter((l) => l.kindId !== 'sidewalk').length <= MAX_PRIMARY_LANES,
  );
  check(
    "clamping preserves a lopsided split's shape",
    (() => {
      const p = lanesOf(
        profileFromOsmTags('road', 'arterial', {
          highway: 'primary',
          'lanes:forward': '30',
          'lanes:backward': '10',
        }),
      );
      const f = p.filter((l) => l.direction === 'forward').length;
      const b = p.filter((l) => l.direction === 'backward').length;
      return p.length <= MAX_PRIMARY_LANES && f > b && b >= 1;
    })(),
  );

  // Rail and bike keep their catalog defaults — lanes is road vocabulary.
  check(
    'a tram way ignores road lane tags',
    profileFromOsmTags('lightRail', undefined, { railway: 'tram', lanes: '4' }).lanes.length ===
      defaultProfileFor('lightRail').lanes.length,
  );

  // And the whole thing flows through the real import path.
  const tagged: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', oneway: 'yes', lanes: '3' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    'osmElementsToNetwork applies the tag-derived profile',
    isOneWay(osmElementsToNetwork(tagged).ways[0].profile),
  );
}

// --- P4: OSM import reads bike lanes tagged on the roadway ---
{
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.map((l) => l.kindId).join(',');
  const base = { highway: 'secondary', lanes: '2' };

  check(
    'no cycleway tag means no bike lane',
    !kinds(profileFromOsmTags('road', 'arterial', base)).includes('bike'),
  );
  check(
    'cycleway=lane puts a bike lane at both kerbs',
    kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'lane' })) ===
      'sidewalk,bike,drive,drive,bike,sidewalk',
  );
  check(
    'cycleway:right=track is read as a bike lane too',
    kinds(profileFromOsmTags('road', 'arterial', { ...base, 'cycleway:right': 'track' })) ===
      'sidewalk,drive,drive,bike,sidewalk',
  );
  // The cycleway is its own way in OSM, and imports as one — drawing a lane
  // here as well would render the same bike infrastructure twice.
  check(
    'cycleway=separate adds no lane',
    !kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'separate' })).includes(
      'bike',
    ),
  );
  check(
    'cycleway=no adds no lane',
    !kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'no' })).includes('bike'),
  );
  check(
    'share_busway is bikes in the bus lane, not a lane of its own',
    !kinds(profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'share_busway' })).includes(
      'bike',
    ),
  );
  check(
    'a bike lane does not consume a travel lane',
    profileFromOsmTags('road', 'arterial', { ...base, cycleway: 'lane' }).lanes.filter(
      (l) => l.kindId === 'drive',
    ).length === 2,
  );
  // Kerb outwards-in: parking, then bike, then bus, then the travel lanes.
  check(
    'the kerb-inwards order is parking, bike, bus',
    kinds(
      profileFromOsmTags('road', 'arterial', {
        ...base,
        'parking:lane:right': 'parallel',
        'cycleway:right': 'lane',
        'busway:right': 'lane',
      }),
    ) === 'sidewalk,drive,drive,bus,bike,parking,sidewalk',
  );
}

// --- P4: OSM import reads on-street parking ---
{
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.map((l) => l.kindId).join(',');
  const base = { highway: 'residential', lanes: '2' };

  check(
    'no parking tag means no parking lane',
    !kinds(profileFromOsmTags('road', 'local', base)).includes('parking'),
  );
  check(
    'the older parking:lane scheme is read',
    kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'parallel' })) ===
      'sidewalk,parking,drive,drive,parking,sidewalk',
  );
  check(
    'the newer parking:<side> scheme is read too',
    kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:right': 'lane' })) ===
      'sidewalk,drive,drive,parking,sidewalk',
  );
  check(
    'parking:lane:both=no adds nothing',
    !kinds(profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'no' })).includes(
      'parking',
    ),
  );
  check(
    'no_stopping is not parking',
    !kinds(
      profileFromOsmTags('road', 'local', { ...base, 'parking:lane:left': 'no_stopping' }),
    ).includes('parking'),
  );
  check(
    'parking is stationary, so it has no direction',
    profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'parallel' })
      .lanes.filter((l) => l.kindId === 'parking')
      .every((l) => l.direction === 'none'),
  );
  check(
    'parking does not consume a travel lane',
    profileFromOsmTags('road', 'local', { ...base, 'parking:lane:both': 'parallel' }).lanes.filter(
      (l) => l.kindId === 'drive',
    ).length === 2,
  );
  // Kerb outwards-in: parking is outboard of a bus lane on the same side.
  check(
    'parking sits outboard of a bus lane on the same side',
    kinds(
      profileFromOsmTags('road', 'arterial', {
        ...base,
        'parking:lane:right': 'parallel',
        'busway:right': 'lane',
      }),
    ) === 'sidewalk,drive,drive,bus,parking,sidewalk',
  );
}

// --- P4: OSM import reads bus lanes ---
{
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.map((l) => l.kindId).join(',');
  const dirOf = (p: ReturnType<typeof profileFromOsmTags>, kindId: string) =>
    p.lanes
      .filter((l) => l.kindId === kindId)
      .map((l) => l.direction)
      .join(',');

  check(
    'no busway tag means no bus lane',
    !kinds(profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2' })).includes(
      'bus',
    ),
  );
  check(
    'busway=lane puts a bus lane on both kerbs',
    kinds(
      profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'lane' }),
    ) === 'sidewalk,bus,drive,drive,bus,sidewalk',
  );
  check(
    'busway:right=lane puts one on the right only',
    kinds(
      profileFromOsmTags('road', 'arterial', {
        highway: 'primary',
        lanes: '2',
        'busway:right': 'lane',
      }),
    ) === 'sidewalk,drive,drive,bus,sidewalk',
  );
  check(
    'a side-specific tag beats the both-sides one',
    kinds(
      profileFromOsmTags('road', 'arterial', {
        highway: 'primary',
        lanes: '2',
        busway: 'lane',
        'busway:left': 'no',
      }),
    ) === 'sidewalk,drive,drive,bus,sidewalk',
  );
  check(
    'busway=no adds nothing',
    !kinds(
      profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'no' }),
    ).includes('bus'),
  );
  check(
    'a bus lane runs with the traffic beside it',
    dirOf(
      profileFromOsmTags('road', 'arterial', { highway: 'primary', lanes: '2', busway: 'lane' }),
      'bus',
    ) === 'backward,forward',
  );
  check(
    "on a one-way street both bus lanes run the way's direction",
    dirOf(
      profileFromOsmTags('road', 'arterial', {
        highway: 'primary',
        oneway: 'yes',
        lanes: '2',
        busway: 'lane',
      }),
      'bus',
    ) === 'forward,forward',
  );
  // Bus lanes are additional to `lanes`, not carved out of it.
  check(
    'a bus lane does not consume a travel lane',
    profileFromOsmTags('road', 'arterial', {
      highway: 'primary',
      lanes: '4',
      busway: 'lane',
    }).lanes.filter((l) => l.kindId === 'drive').length === 4,
  );
  // busway:right names the way's right-hand side in every country, so the
  // lane stays at that kerb; only the two travel lanes swap direction order.
  check(
    'a bus lane keeps its tagged kerb under left-hand traffic',
    kinds(
      profileFromOsmTags(
        'road',
        'arterial',
        { highway: 'primary', lanes: '2', 'busway:right': 'lane' },
        'left',
      ),
    ) === 'sidewalk,drive,drive,bus,sidewalk',
  );
}

// --- P4: OSM import places lanes for the system's driving side ---
{
  const kinds = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.map((l) => `${l.kindId}:${l.direction}`).join(',');
  const tags = { highway: 'primary', lanes: '4' };
  const right = profileFromOsmTags('road', 'arterial', tags, 'right');
  const left = profileFromOsmTags('road', 'arterial', tags, 'left');

  check(
    'right-hand traffic keeps backward lanes on the left',
    kinds(right) ===
      'sidewalk:both,drive:backward,drive:backward,drive:forward,drive:forward,sidewalk:both',
  );
  check(
    'left-hand traffic puts forward lanes on the left',
    kinds(left) ===
      'sidewalk:both,drive:forward,drive:forward,drive:backward,drive:backward,sidewalk:both',
  );
  check(
    'right-hand traffic is still the default',
    kinds(profileFromOsmTags('road', 'arterial', tags)) === kinds(right),
  );

  // OSM's :left/:right are relative to the WAY's forward direction in every
  // country, so a tagged side must not move with the driving side. A one-way
  // street is the decisive case: every lane runs the same way, so there is no
  // direction arrangement to swap, and anything that moves has been misplaced.
  const oneWayBus = { highway: 'primary', oneway: 'yes', lanes: '3', 'busway:left': 'lane' };
  check(
    'a tagged kerb lane stays on that kerb under left-hand traffic',
    kinds(profileFromOsmTags('road', 'arterial', oneWayBus, 'left')) ===
      kinds(profileFromOsmTags('road', 'arterial', oneWayBus, 'right')),
  );
  check(
    'and it really is the left kerb',
    profileFromOsmTags('road', 'arterial', oneWayBus, 'left').lanes[1].kindId === 'bus',
  );

  const oneSidewalk = { highway: 'primary', lanes: '2', 'sidewalk:left': 'no' };
  const swRight = profileFromOsmTags('road', 'arterial', oneSidewalk, 'right');
  const swLeft = profileFromOsmTags('road', 'arterial', oneSidewalk, 'left');
  check(
    'sidewalk:left=no drops the left sidewalk under RHT',
    swRight.lanes[0].kindId !== 'sidewalk' &&
      swRight.lanes[swRight.lanes.length - 1].kindId === 'sidewalk',
  );
  check(
    'and drops the same one under LHT',
    swLeft.lanes[0].kindId !== 'sidewalk' &&
      swLeft.lanes[swLeft.lanes.length - 1].kindId === 'sidewalk',
  );

  for (const [tag, kind] of [
    ['cycleway:left', 'bike'],
    ['parking:lane:left', 'parallel'],
    ['busway:left', 'lane'],
  ] as const) {
    const t = {
      highway: 'primary',
      lanes: '2',
      [tag]: kind === 'parallel' ? 'parallel' : kind === 'bike' ? 'lane' : 'lane',
    } as Record<string, string>;
    check(
      `${tag} lands on the same physical side under either driving side`,
      kinds(profileFromOsmTags('road', 'arterial', t, 'left'))
        .split(',')
        .findIndex((x) => !x.startsWith('sidewalk') && !x.startsWith('drive')) ===
        kinds(profileFromOsmTags('road', 'arterial', t, 'right'))
          .split(',')
          .findIndex((x) => !x.startsWith('sidewalk') && !x.startsWith('drive')),
    );
  }

  // turn:lanes is likewise ordered by the driver's own direction of travel.
  const turns = {
    highway: 'primary',
    oneway: 'yes',
    lanes: '3',
    'turn:lanes': 'left|through|through',
  };
  const pocketAt = (side: 'left' | 'right') =>
    profileFromOsmTags('road', 'arterial', turns, side).lanes.findIndex(
      (l) => l.kindId === 'turnPocket',
    );
  check(
    "a one-way street's turn pocket does not move with the driving side",
    pocketAt('left') === pocketAt('right'),
  );
  check("and it is the driver's leftmost lane", pocketAt('right') === 1);

  // A two-way street's blocks DO swap, and each block keeps its own ordering.
  const twoWayTurns = {
    highway: 'primary',
    lanes: '4',
    'lanes:forward': '2',
    'lanes:backward': '2',
    'turn:lanes:forward': 'left|through',
  };
  const twRight = profileFromOsmTags('road', 'arterial', twoWayTurns, 'right');
  const twLeft = profileFromOsmTags('road', 'arterial', twoWayTurns, 'left');
  const fwdPocket = (p: ReturnType<typeof profileFromOsmTags>) =>
    p.lanes.findIndex((l) => l.kindId === 'turnPocket');
  check('under RHT the forward block sits on the right', twRight.lanes[3].direction === 'forward');
  check('under LHT the forward block sits on the left', twLeft.lanes[1].direction === 'forward');
  check(
    "the forward block's turn pocket stays its own leftmost lane",
    twRight.lanes[fwdPocket(twRight)].direction === 'forward' &&
      twLeft.lanes[fwdPocket(twLeft)].direction === 'forward',
  );

  // And it flows through the real entry point.
  const el: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', lanes: '4' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    'osmElementsToNetwork honours the driving side',
    kinds(osmElementsToNetwork(el, 'left').ways[0].profile) === kinds(left),
  );
}

// --- P4: OSM import reads grade and junction control ---
{
  check('no grade tags means at grade', gradeFromOsmTags({ highway: 'primary' }) === 'atGrade');
  check('bridge=yes is elevated', gradeFromOsmTags({ bridge: 'yes' }) === 'elevated');
  check('tunnel=yes is underground', gradeFromOsmTags({ tunnel: 'yes' }) === 'underground');
  check('bridge=no is not a bridge', gradeFromOsmTags({ bridge: 'no' }) === 'atGrade');
  check('a positive layer alone is elevated', gradeFromOsmTags({ layer: '2' }) === 'elevated');
  check(
    'a negative layer alone is underground',
    gradeFromOsmTags({ layer: '-1' }) === 'underground',
  );
  check('layer=0 is at grade', gradeFromOsmTags({ layer: '0' }) === 'atGrade');
  check(
    'tunnel wins over a positive layer',
    gradeFromOsmTags({ tunnel: 'yes', layer: '1' }) === 'underground',
  );

  // Junction control comes from OSM node elements, matched by node id.
  const controlled: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [10, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    { type: 'node', id: 500, tags: { highway: 'traffic_signals' } },
  ];
  const controlledNet = osmElementsToNetwork(controlled);
  check(
    'a traffic_signals node controls its junction',
    controlledNet.nodes[0]?.control === 'signal',
  );
  check('a control node is not itself imported as a way', controlledNet.ways.length === 2);

  const stopTagged: OsmWayElement[] = [
    ...controlled.slice(0, 2),
    { type: 'node', id: 500, tags: { highway: 'stop' } },
  ];
  check(
    'a stop node controls its junction',
    osmElementsToNetwork(stopTagged).nodes[0]?.control === 'stop',
  );

  const uncontrolled: OsmWayElement[] = controlled.slice(0, 2);
  check(
    'a junction with no control node stays uncontrolled',
    osmElementsToNetwork(uncontrolled).nodes[0]?.control === undefined,
  );

  // junction=roundabout is a way tag, so its junctions inherit it.
  const roundabout: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', junction: 'roundabout' },
      nodes: [500, 501],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.101, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    'a roundabout way marks its junctions as roundabouts',
    osmElementsToNetwork(roundabout).nodes[0]?.control === 'roundabout',
  );

  const signalledRoundabout: OsmWayElement[] = [
    ...roundabout,
    { type: 'node', id: 500, tags: { highway: 'traffic_signals' } },
  ];
  check(
    'an explicit signal beats the roundabout inferred from the way',
    osmElementsToNetwork(signalledRoundabout).nodes[0]?.control === 'signal',
  );

  // The case real OSM data actually produces: the signal sits at the stop
  // line partway along one approach, not on the shared junction node. ~35m
  // west of the junction at -115.15.
  const stopLine: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [10, 900, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1504 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
  ];
  const stopLineNet = osmElementsToNetwork(stopLine);
  check(
    'a stop-line signal controls the junction it approaches',
    stopLineNet.nodes[0]?.control === 'signal',
  );
  check('the stop-line node itself is not a junction', stopLineNet.nodes.length === 1);

  // Too far back to be this junction's stop line (~900m).
  const distant: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [10, 900, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.16 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
  ];
  check(
    'a signal far from any junction controls nothing',
    osmElementsToNetwork(distant).nodes[0]?.control === undefined,
  );

  // A signal on one carriageway must not reach the parallel one ~17m away,
  // which is why the search walks the way instead of measuring straight-line.
  const parallel: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', oneway: 'yes' },
      nodes: [10, 900],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1504 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', oneway: 'yes' },
      nodes: [20, 500],
      geometry: [
        { lat: 36.10015, lon: -115.2 },
        { lat: 36.10015, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'primary' },
      nodes: [500, 21],
      geometry: [
        { lat: 36.10015, lon: -115.15 },
        { lat: 36.101, lon: -115.15 },
      ],
    },
    { type: 'node', id: 900, tags: { highway: 'traffic_signals' } },
  ];
  check(
    'a signal does not reach a junction on the neighbouring carriageway',
    osmElementsToNetwork(parallel).nodes.every((n) => n.control === undefined),
  );

  check(
    'the query asks for control nodes when importing streets',
    buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, ['road']).includes(
      'traffic_signals',
    ),
  );
  check(
    "the query leaves control nodes out when streets aren't wanted",
    !buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, [
      'heavyRail',
    ]).includes('traffic_signals'),
  );
}

// --- P4: OSM import gives imported streets their real names ---
{
  // OSM splits one street into many ways sharing a name — exactly NamedWay.
  const named: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'West Flamingo Road' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'West Flamingo Road' },
      nodes: [2, 3],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential', name: 'Audrie Street' },
      nodes: [4, 5],
      geometry: [
        { lat: 36.2, lon: -115.2 },
        { lat: 36.2, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential' },
      nodes: [6, 7],
      geometry: [
        { lat: 36.3, lon: -115.2 },
        { lat: 36.3, lon: -115.1 },
      ],
    },
  ];
  const namedNet = osmElementsToNetwork(named);
  check('ways sharing a name become one NamedWay', namedNet.namedWays.length === 1);
  check("the NamedWay takes OSM's name", namedNet.namedWays[0].name === 'West Flamingo Road');
  check("the NamedWay spans both of that street's ways", namedNet.namedWays[0].wayIds.length === 2);
  check(
    'a name on a single way needs no shared identity',
    !namedNet.namedWays.some((n) => n.name === 'Audrie Street'),
  );

  // A street and a tram line can share a name without being one facility.
  const sameName: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Main Street' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { railway: 'tram', name: 'Main Street' },
      nodes: [3, 4],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    'a road and a tram sharing a name stay separate identities',
    osmElementsToNetwork(sameName).namedWays.length === 0,
  );

  fresh();
  store.getState().importWays(osmElementsToNetwork(named));
  check(
    "importWays appends the import's street identities",
    store.getState().system.namedWays.length === 1,
  );
}

// --- P4: re-importing an area doesn't duplicate what's already there ---
{
  const area: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [10, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];

  // First import into an empty system: nothing to skip.
  const first = withoutAlreadyImported(osmElementsToNetwork(area), []);
  check('a first import keeps every way', first.network.ways.length === 2);
  check('a first import skips nothing', first.duplicateWays === 0);
  check('a first import keeps its junction', first.network.nodes.length === 1);

  // The exact same area again: everything is already there.
  const again = withoutAlreadyImported(osmElementsToNetwork(area), first.network.ways);
  check('re-importing the same area adds no ways', again.network.ways.length === 0);
  check('re-importing reports what it skipped', again.duplicateWays === 2);
  check('re-importing adds no duplicate junction', again.network.nodes.length === 0);

  // A neighbouring area that overlaps: Overpass returns way 2 whole again.
  const neighbour: OsmWayElement[] = [
    area[1],
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential' },
      nodes: [11, 12],
      geometry: [
        { lat: 36.1, lon: -115.1 },
        { lat: 36.1, lon: -115.05 },
      ],
    },
  ];
  const seam = withoutAlreadyImported(osmElementsToNetwork(neighbour), first.network.ways);
  check(
    "an overlapping import keeps only what's new",
    seam.network.ways.length === 1 && seam.duplicateWays === 1,
  );
  check('the seam junction survives', seam.network.nodes.length === 1);
  const seamRefs = seam.network.nodes[0].refs;
  check(
    'the seam junction points one ref at the already-present way',
    seamRefs.some((r) => first.network.ways.some((w) => w.id === r.wayId)),
  );
  check(
    'and one ref at the newly imported way',
    seamRefs.some((r) => r.wayId === seam.network.ways[0].id),
  );

  // A way the user has since edited: still a duplicate, but its indices no
  // longer mean what OSM meant, so refs into it are not re-pointed.
  const edited = first.network.ways.map((w) =>
    w.source === 'osm:2' ? { ...w, points: [...w.points, [-115.05, 36.1] as [number, number]] } : w,
  );
  const afterEdit = withoutAlreadyImported(osmElementsToNetwork(neighbour), edited);
  check('an edited way is still recognised as a duplicate', afterEdit.duplicateWays === 1);
  check('but no junction is placed on its shifted indices', afterEdit.network.nodes.length === 0);

  // A junction the system already has must GAIN the new arm, not acquire a
  // rival Node at the same coordinate. Two Nodes there is not cosmetic:
  // cascadeMove finds only the first, so dragging the junction strands the
  // other's arms, and setNodeControl reaches only one of them.
  const withBike: OsmWayElement[] = [
    ...area,
    {
      type: 'way',
      id: 4,
      tags: { highway: 'cycleway' },
      nodes: [500, 40],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.11, lon: -115.15 },
      ],
    },
  ];
  const widened = withoutAlreadyImported(
    osmElementsToNetwork(withBike),
    first.network.ways,
    first.network.namedWays,
    first.network.nodes,
  );
  check('widening the categories adds no rival junction', widened.network.nodes.length === 0);
  check(
    'the existing junction gains the new arm instead',
    widened.junctionAdditions.length === 1 && widened.junctionAdditions[0].refs.length === 1,
  );
  check(
    'the arm names the newly imported way',
    widened.junctionAdditions[0].refs[0].wayId === widened.network.ways[0].id,
  );

  fresh();
  store.getState().importWays(osmElementsToNetwork(area));
  const beforeNodes = store.getState().system.nodes.length;
  store.getState().importWays(osmElementsToNetwork(withBike));
  const shared = store
    .getState()
    .system.nodes.filter((n) => n.coord[0] === -115.15 && n.coord[1] === 36.1);
  check(
    'the store keeps one junction at the shared coordinate',
    beforeNodes === 1 && shared.length === 1,
  );
  check('and it now has three arms', shared[0].refs.length === 3);
  check(
    'every arm names a way that exists',
    shared[0].refs.every((r) => store.getState().system.ways.some((w) => w.id === r.wayId)),
  );

  // Street identities follow the same rule as junctions.
  const namedArea: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Main Street' },
      nodes: [10, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Main Street' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  const namedFirst = withoutAlreadyImported(osmElementsToNetwork(namedArea), []);
  check('a first import keeps its street identity', namedFirst.network.namedWays.length === 1);
  check(
    're-importing adds no duplicate identity',
    withoutAlreadyImported(
      osmElementsToNetwork(namedArea),
      namedFirst.network.ways,
      namedFirst.network.namedWays,
    ).network.namedWays.length === 0,
  );

  // A street continuing into a neighbouring import must end up in ONE
  // identity: a second one would rename half the street and would double-count
  // the shared way in the member count the carriageway tools gate on.
  const namedNeighbour: OsmWayElement[] = [
    namedArea[1],
    {
      type: 'way',
      id: 3,
      tags: { highway: 'primary', name: 'Main Street' },
      nodes: [11, 12],
      geometry: [
        { lat: 36.1, lon: -115.1 },
        { lat: 36.1, lon: -115.05 },
      ],
    },
  ];
  const extended = withoutAlreadyImported(
    osmElementsToNetwork(namedNeighbour),
    namedFirst.network.ways,
    namedFirst.network.namedWays,
  );
  check(
    'a street continuing into the next import creates no second identity',
    extended.network.namedWays.length === 0,
  );
  check(
    'it extends the identity it already has',
    extended.identityAdditions.length === 1 &&
      extended.identityAdditions[0].id === namedFirst.network.namedWays[0].id,
  );
  check(
    'only the genuinely new way is added to it',
    extended.identityAdditions[0].wayIds.length === 1,
  );

  // Same name, different way type, is still a different facility.
  const tramNamed: OsmWayElement[] = [
    {
      type: 'way',
      id: 8,
      tags: { railway: 'tram', name: 'Main Street' },
      nodes: [80, 81],
      geometry: [
        { lat: 36.3, lon: -115.2 },
        { lat: 36.3, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 9,
      tags: { railway: 'tram', name: 'Main Street' },
      nodes: [81, 82],
      geometry: [
        { lat: 36.3, lon: -115.15 },
        { lat: 36.3, lon: -115.1 },
      ],
    },
  ];
  const tram = withoutAlreadyImported(
    osmElementsToNetwork(tramNamed),
    namedFirst.network.ways,
    namedFirst.network.namedWays,
  );
  check(
    "a same-named tram line does not join the road's identity",
    tram.network.namedWays.length === 1 && tram.identityAdditions.length === 0,
  );

  // And the store applies the merge, so no way ends up in two identities.
  fresh();
  store.getState().importWays(osmElementsToNetwork(namedArea));
  store.getState().importWays(osmElementsToNetwork(namedNeighbour));
  const memberships = new Map<string, number>();
  for (const n of store.getState().system.namedWays)
    for (const id of n.wayIds) memberships.set(id, (memberships.get(id) ?? 0) + 1);
  check(
    'overlapping imports leave every way in at most one identity',
    [...memberships.values()].every((n) => n === 1),
  );
  check(
    'and the street is one identity spanning all three ways',
    store.getState().system.namedWays.length === 1 &&
      store.getState().system.namedWays[0].wayIds.length === 3,
  );

  // Hand-drawn ways have no source and must never be mistaken for imports.
  const handDrawn: Way[] = [
    {
      id: 'drawn',
      typeId: 'road',
      points: [
        [-115.2, 36.1],
        [-115.15, 36.1],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
    },
  ];
  check(
    'hand-drawn ways never count as duplicates',
    withoutAlreadyImported(osmElementsToNetwork(area), handDrawn).duplicateWays === 0,
  );

  // And the store enforces it, whatever the caller passes.
  fresh();
  store.getState().importWays(osmElementsToNetwork(area));
  const second = store.getState().importWays(osmElementsToNetwork(area));
  check(
    'the store skips duplicates rather than trusting the caller',
    store.getState().system.ways.length === 2,
  );
  check('the store reports added/skipped', second.added === 0 && second.skipped === 2);
}

// --- P4: OSM import reads turn-restriction relations ---
{
  // A crossroads: `from` runs west->east into the junction, three arms leave.
  const junction = (restriction: string): OsmWayElement[] => [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [10, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary' },
      nodes: [500, 11],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'primary' },
      nodes: [500, 12],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.11, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'primary' },
      nodes: [500, 13],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.09, lon: -115.15 },
      ],
    },
    {
      type: 'relation',
      id: 99,
      tags: { type: 'restriction', restriction },
      members: [
        { type: 'way', ref: 1, role: 'from' },
        { type: 'node', ref: 500, role: 'via' },
        { type: 'way', ref: 3, role: 'to' },
      ],
    },
  ];

  const banned = osmElementsToNetwork(junction('no_left_turn'));
  const fromWay = banned.ways.find((w) => w.source === 'osm:1')!;
  const toWay = banned.ways.find((w) => w.source === 'osm:3')!;
  const straightOn = banned.ways.find((w) => w.source === 'osm:2')!;
  check('a no_* restriction produces a turn restriction', banned.turnRestrictions.length > 0);
  check(
    "keyed against the approaching way's lanes",
    banned.turnRestrictions.every((t) => t.key.startsWith(`${fromWay.id}:`)),
  );
  check(
    'the banned way is not an allowed target',
    banned.turnRestrictions.every((t) => !t.restriction.allowedTargets.includes(toWay.id)),
  );
  check(
    'the other arms still are',
    banned.turnRestrictions.every((t) => t.restriction.allowedTargets.includes(straightOn.id)),
  );

  const only = osmElementsToNetwork(junction('only_straight_on'));
  check(
    'an only_* restriction permits just the named arm',
    only.turnRestrictions.every((t) => t.restriction.allowedTargets.length === 1),
  );
  check(
    'and that arm is the one named',
    only.turnRestrictions.every(
      (t) =>
        t.restriction.allowedTargets[0] === toWay.id ||
        t.restriction.allowedTargets[0] === only.ways.find((w) => w.source === 'osm:3')!.id,
    ),
  );

  // Vocabulary is checked: a typo must not be applied as a real ban.
  check(
    'an unrecognised restriction value is ignored',
    osmElementsToNetwork(junction('no_lu_turn')).turnRestrictions.length === 0,
  );

  // A via-WAY restriction has no per-lane expression at one junction.
  const viaWay: OsmWayElement[] = [
    ...junction('no_left_turn').slice(0, 4),
    {
      type: 'relation',
      id: 98,
      tags: { type: 'restriction', restriction: 'no_left_turn' },
      members: [
        { type: 'way', ref: 1, role: 'from' },
        { type: 'way', ref: 2, role: 'via' },
        { type: 'way', ref: 3, role: 'to' },
      ],
    },
  ];
  check(
    'a via-way restriction is skipped',
    osmElementsToNetwork(viaWay).turnRestrictions.length === 0,
  );

  // A relation naming a way the import skipped can't be applied safely.
  const missingArm: OsmWayElement[] = [
    ...junction('no_left_turn').slice(0, 4),
    {
      type: 'relation',
      id: 97,
      tags: { type: 'restriction', restriction: 'no_left_turn' },
      members: [
        { type: 'way', ref: 1, role: 'from' },
        { type: 'node', ref: 500, role: 'via' },
        { type: 'way', ref: 42, role: 'to' },
      ],
    },
  ];
  check(
    'a restriction naming an unimported way is skipped',
    osmElementsToNetwork(missingArm).turnRestrictions.length === 0,
  );

  // The ban must land on lanes that could make the turn, not on a kerbside
  // bike lane that happens to be outermost.
  const withBike = junction('no_right_turn').map((el) =>
    el.type === 'way' && el.id === 1
      ? { ...el, tags: { ...el.tags, 'cycleway:right': 'lane' } }
      : el,
  );
  const bikeNet = osmElementsToNetwork(withBike);
  const bikeFrom = bikeNet.ways.find((w) => w.source === 'osm:1')!;
  const bikeLaneIds = new Set(
    bikeFrom.profile.lanes.filter((l) => l.kindId === 'bike').map((l) => l.id),
  );
  check('the approach has a bike lane', bikeLaneIds.size === 1);
  check(
    'but no ban is placed on it',
    bikeNet.turnRestrictions.every((t) => !bikeLaneIds.has(t.key.split(':')[1])),
  );

  check(
    'the query asks for restriction relations when importing streets',
    buildOverpassQuery({ west: -115.3, south: 36, east: -115, north: 36.2 }, ['road']).includes(
      '"type"="restriction"',
    ),
  );

  // End to end through the store.
  fresh();
  store.getState().importWays(osmElementsToNetwork(junction('no_left_turn')));
  check(
    'the store records the imported turn restrictions',
    Object.keys(store.getState().system.turnRestrictions).length > 0,
  );
  const storedFrom = store.getState().system.ways.find((w) => w.source === 'osm:1')!;
  check(
    'each stored key names a lane that exists',
    Object.keys(store.getState().system.turnRestrictions).every((k) =>
      storedFrom.profile.lanes.some((l) => laneRefKey(storedFrom.id, l.id) === k),
    ),
  );
  // And deleting the approach takes them with it, via touch()'s pruning.
  store.getState().deleteWay(storedFrom.id);
  check(
    'deleting the approach drops its imported restrictions',
    Object.keys(store.getState().system.turnRestrictions).length === 0,
  );
}

// --- P4: OSM import pairs the carriageways of a divided street ---
{
  // Two one-way ways, same name, running opposite ways about 22 m apart.
  const divided: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [10, 11],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [20, 21],
      geometry: [
        { lat: 36.1002, lon: -115.1 },
        { lat: 36.1002, lon: -115.2 },
      ],
    },
  ];
  const net = osmElementsToNetwork(divided);
  check('a divided street pairs into one identity', net.namedWays.length === 1);
  check('the pair has exactly the two carriageways', net.namedWays[0].wayIds.length === 2);
  check('which is the shape the combine tool needs', net.namedWays[0].name === 'Grand Boulevard');
  check(
    'and the median between them is captured',
    net.medians.length === 1 && net.medians[0].id === net.namedWays[0].id,
  );
  check('the captured median has a positive width', net.medians[0].median.widthM > 0);

  // Same street, same direction: not a carriageway pair.
  const sameWay: OsmWayElement[] = [
    divided[0],
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [20, 21],
      geometry: [
        { lat: 36.1002, lon: -115.2 },
        { lat: 36.1002, lon: -115.1 },
      ],
    },
  ];
  const parallelSame = osmElementsToNetwork(sameWay);
  check(
    'two same-direction one-ways are not a carriageway pair',
    parallelSame.medians.length === 0,
  );
  check(
    'they keep the ordinary whole-street identity',
    parallelSame.namedWays.length === 1 && parallelSame.namedWays[0].wayIds.length === 2,
  );

  // Too far apart to be one street's carriageways.
  const farApart: OsmWayElement[] = [
    divided[0],
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [20, 21],
      geometry: [
        { lat: 36.11, lon: -115.1 },
        { lat: 36.11, lon: -115.2 },
      ],
    },
  ];
  check(
    'opposite one-ways a block apart are not paired',
    osmElementsToNetwork(farApart).medians.length === 0,
  );

  // Two-way streets are never carriageways.
  const twoWay: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Plain Street', lanes: '2' },
      nodes: [10, 11],
      geometry: [
        { lat: 36.2, lon: -115.2 },
        { lat: 36.2, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Plain Street', lanes: '2' },
      nodes: [20, 21],
      geometry: [
        { lat: 36.2002, lon: -115.1 },
        { lat: 36.2002, lon: -115.2 },
      ],
    },
  ];
  check(
    'two-way ways are never paired as carriageways',
    osmElementsToNetwork(twoWay).medians.length === 0,
  );

  // A frontage road alongside the pair must not steal a carriageway: pairing
  // is mutual-best-match, so the two true carriageways choose each other.
  const withFrontage: OsmWayElement[] = [
    ...divided,
    {
      type: 'way',
      id: 3,
      tags: { highway: 'service', name: 'Grand Boulevard', oneway: 'yes', lanes: '1' },
      nodes: [30, 31],
      geometry: [
        { lat: 36.1004, lon: -115.2 },
        { lat: 36.1004, lon: -115.1 },
      ],
    },
  ];
  const fronted = osmElementsToNetwork(withFrontage);
  check(
    'a frontage road does not break the true pair',
    fronted.namedWays.some((n) => n.wayIds.length === 2),
  );

  // End to end: the store gets a two-member identity with its median, which
  // is exactly what the Combine affordance requires.
  fresh();
  store.getState().importWays(osmElementsToNetwork(divided));
  const nw = store.getState().system.namedWays[0];
  check('the store receives a two-carriageway identity', nw.wayIds.length === 2);
  check(
    'with its median stored against it',
    getComponent(store.getState().system.medians, nw.id) !== undefined,
  );
  store.getState().combineCarriageways(nw.id);
  const after = store.getState().system;
  check('so the divided street combines into one two-way street', after.ways.length === 1);
  check(
    'carrying a median lane from the captured gap',
    after.ways[0].profile.lanes.some((l) => l.kindId === 'median'),
  );
}

// --- P4: OSM import derives junctions from node identity, not coordinates ---
{
  // Two streets crossing at OSM node 500, which is each way's middle point.
  const crossing: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 500, 101],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [200, 500, 201],
      geometry: [
        { lat: 36.05, lon: -115.15 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.15, lon: -115.15 },
      ],
    },
  ];
  const net = osmElementsToNetwork(crossing);
  check('osmElementsToNetwork returns both ways', net.ways.length === 2);
  check('a node id shared by two ways becomes exactly one junction', net.nodes.length === 1);
  check('the junction carries one ref per way', net.nodes[0].refs.length === 2);
  check(
    "each ref points at the shared node's own control point index",
    net.nodes[0].refs.every((r) => r.pointIndex === 1),
  );
  check(
    "the junction's refs name the imported ways",
    net.nodes[0].refs.every((r) => net.ways.some((w) => w.id === r.wayId)),
  );
  check(
    'the junction sits at the shared coordinate',
    net.nodes[0].coord[0] === -115.15 && net.nodes[0].coord[1] === 36.1,
  );

  // Five ways meeting at one node is one junction with five refs, not ten
  // pairwise ones — a real Flamingo Rd sample had a node of degree 5.
  const fanOut: OsmWayElement[] = [1, 2, 3, 4, 5].map((n) => ({
    type: 'way',
    id: n,
    tags: { highway: 'residential' },
    nodes: [900, 900 + n],
    geometry: [
      { lat: 36.1, lon: -115.15 },
      { lat: 36.1 + n / 100, lon: -115.15 },
    ],
  }));
  const fan = osmElementsToNetwork(fanOut);
  check('five ways at one node produce a single junction', fan.nodes.length === 1);
  check('that junction has five refs', fan.nodes[0].refs.length === 5);

  // The case coordinate matching gets wrong: a tram drawn down a street.
  // Identical coordinates, different node ids — they overlap, they do not join.
  const coLocated: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 101],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { railway: 'tram' },
      nodes: [200, 201],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    'identical coordinates with different node ids produce no junction',
    osmElementsToNetwork(coLocated).nodes.length === 0,
  );

  // A closed way (roundabout, loop road) repeats its first node id last, so
  // that node has two refs from ONE way. It stays a junction deliberately:
  // routeGraph keys vertices by "wayId:pointIndex" through node identity, so
  // sharing the node is what makes the loop actually close in the graph, and
  // it keeps the two ends moving together when either is dragged.
  const closedWay: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 101, 102, 100],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1005, lon: -115.15 },
        { lat: 36.1005, lon: -115.1495 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
  ];
  const closedNet = osmElementsToNetwork(closedWay);
  check("a closed way's repeated node still forms a junction", closedNet.nodes.length === 1);
  check(
    "that junction links the way's first and last point",
    closedNet.nodes[0].refs
      .map((r) => r.pointIndex)
      .sort()
      .join(',') === '0,3',
  );
  check(
    'it is one way meeting itself, not two ways',
    new Set(closedNet.nodes[0].refs.map((r) => r.wayId)).size === 1,
  );

  // Unshared node ids are ordinary vertices, not junctions.
  const disjoint: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 101, 102],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
  ];
  check(
    "a lone way's own vertices produce no junctions",
    osmElementsToNetwork(disjoint).nodes.length === 0,
  );

  // A node shared with a skipped element isn't a junction: the footpath was
  // never imported, so there's nothing on the other side of it.
  const withSkipped: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'footway' },
      nodes: [500, 201],
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.2, lon: -115.15 },
      ],
    },
  ];
  const skipped = osmElementsToNetwork(withSkipped);
  check(
    "an unimported element's shared node forms no junction",
    skipped.ways.length === 1 && skipped.nodes.length === 0,
  );

  // Misaligned nodes/geometry can't be indexed against each other, so the way
  // imports without refs rather than with wrong ones.
  const misaligned: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential' },
      nodes: [100, 500],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      nodes: [500], // one id, two points
      geometry: [
        { lat: 36.1, lon: -115.15 },
        { lat: 36.2, lon: -115.15 },
      ],
    },
  ];
  const bad = osmElementsToNetwork(misaligned);
  check('a nodes/geometry length mismatch still imports the way', bad.ways.length === 2);
  check('a nodes/geometry length mismatch contributes no refs', bad.nodes.length === 0);
}

// --- P4: importWays store action appends bare infrastructure, no auto-service ---
{
  fresh();
  const imported: Way[] = [
    {
      id: 'osm-a',
      typeId: 'road',
      points: [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
      classId: 'local',
      source: 'osm:123',
    },
    {
      id: 'osm-b',
      typeId: 'road',
      points: [
        [-115.1, 36.1],
        [-115.1, 36.2],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
      classId: 'local',
      source: 'osm:124',
    },
  ];
  store.getState().importWays({
    ways: imported,
    nodes: [
      {
        id: 'osm-j',
        coord: [-115.1, 36.1],
        refs: [
          { wayId: 'osm-a', pointIndex: 1 },
          { wayId: 'osm-b', pointIndex: 0 },
        ],
      },
    ],
    namedWays: [{ id: 'osm-n', name: 'Imported Avenue', wayIds: ['osm-a', 'osm-b'] }],
    medians: [],
    turnRestrictions: [],
  });
  check(
    'importWays appends the way',
    store.getState().system.ways.some((w) => w.id === 'osm-a'),
  );
  check(
    'importWays creates no service for it (bare infrastructure)',
    store.getState().system.services.length === 0,
  );
  check(
    'imported way keeps its OSM source marker',
    store.getState().system.ways.find((w) => w.id === 'osm-a')?.source === 'osm:123',
  );
  check(
    "importWays appends the import's junctions too",
    store.getState().system.nodes.some((n) => n.id === 'osm-j'),
  );
  check(
    'the appended junction still links both imported ways',
    store.getState().system.nodes.find((n) => n.id === 'osm-j')?.refs.length === 2,
  );
  // An imported grid arrives connected, so validate() sees a junction rather
  // than an unjoined crossing — the whole point of carrying nodes through.
  check(
    'an imported junction is not flagged as an unjoined crossing',
    !validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-')),
  );
}

// --- crossings at different grades are bridges, not missing junctions ---
{
  fresh();
  const overpass: Way[] = [
    {
      id: 'surface',
      typeId: 'road',
      points: [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ],
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
    },
    {
      id: 'bridge',
      typeId: 'road',
      points: [
        [-115.15, 36.05],
        [-115.15, 36.15],
      ],
      geometry: 'straight',
      grade: 'elevated',
      profile: defaultProfileFor('road'),
    },
  ];
  store
    .getState()
    .importWays({ ways: overpass, nodes: [], namedWays: [], medians: [], turnRestrictions: [] });
  check(
    'an elevated way crossing a surface street is not flagged',
    !validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-')),
  );

  fresh();
  store.getState().importWays({
    ways: overpass.map((w) => ({ ...w, grade: 'atGrade' as const })),
    nodes: [],
    namedWays: [],
    medians: [],
    turnRestrictions: [],
  });
  check(
    'the same two ways at one grade are still flagged',
    validateSystem(store.getState().system).some((i) => i.id.startsWith('crossing-')),
  );
}

// --- parseGtfsCsv: comma-separated + quoted-field GTFS text ---
{
  const rows = parseGtfsCsv('a,b,c\n1,"hello, world",3\n4,5,6\n');
  check('parseGtfsCsv reads the header as keys', Object.keys(rows[0]).join(',') === 'a,b,c');
  check('parseGtfsCsv splits plain rows', rows.length === 2 && rows[1].a === '4');
  check('parseGtfsCsv keeps a comma inside quotes as one field', rows[0].b === 'hello, world');
}

// --- classifyGtfsRouteType: GTFS route_type → catalog mode/way type ---
{
  check(
    'route_type 3 (bus) maps to bus/road',
    classifyGtfsRouteType(3).modeId === 'bus' && classifyGtfsRouteType(3).wayTypeId === 'road',
  );
  check(
    'route_type 1 (subway) maps to subway/heavyRail',
    classifyGtfsRouteType(1).modeId === 'subway' &&
      classifyGtfsRouteType(1).wayTypeId === 'heavyRail',
  );
  check(
    'an unrecognized route_type falls back to bus/road',
    classifyGtfsRouteType(999).modeId === 'bus',
  );
}

// --- gtfsFilesToSystemPieces: a minimal fixture feed end to end ---
{
  const routes = 'route_id,route_short_name,route_type,route_color\nR1,101,3,E4572E\n';
  const trips = 'route_id,trip_id,shape_id\nR1,T1,S1\n';
  const shapes =
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
    'S1,36.10,-115.20,1\nS1,36.10,-115.17,2\nS1,36.10,-115.14,3\n';
  const stops =
    'stop_id,stop_name,stop_lat,stop_lon\nST1,Downtown,36.10,-115.195\nST2,Midtown,36.10,-115.145\n';
  const stopTimes = 'trip_id,stop_id,stop_sequence\nT1,ST1,1\nT1,ST2,2\n';

  const pieces = gtfsFilesToSystemPieces({ routes, trips, shapes, stops, stopTimes });
  check('one shape becomes one way', pieces.ways.length === 1);
  check('the way carries a GTFS source marker', pieces.ways[0].source === 'gtfs:S1');
  check('the way is typed road (bus route)', pieces.ways[0].typeId === 'road');
  // A GTFS shape is one direction of travel, so the bus way is a lean one-way carriageway.
  check(
    'the imported bus way is a one-way carriageway',
    isOneWay(pieces.ways[0].profile) && laneCapacity(pieces.ways[0].profile) === 2,
  );
  check('one route becomes one service', pieces.services.length === 1);
  check(
    'the service takes its short name and mode',
    pieces.services[0].name === '101' && pieces.services[0].modeId === 'bus',
  );
  check(
    "the service has one pattern riding the shape's way",
    pieces.services[0].patterns.length === 1 &&
      pieces.services[0].patterns[0].wayIds[0] === pieces.ways[0].id,
  );
  check('the route color round-trips as a hex color', pieces.services[0].color === '#E4572E');
  check(
    "both stops become stations, anchored onto the shape's way",
    pieces.stations.length === 2 &&
      pieces.stations.every((s) => s.anchor?.wayId === pieces.ways[0].id),
  );
  check(
    'stations keep their GTFS stop names',
    pieces.stations.some((s) => s.name === 'Downtown') &&
      pieces.stations.some((s) => s.name === 'Midtown'),
  );

  // A stop shared by two routes/shapes stays exactly one station.
  const trips2 = 'route_id,trip_id,shape_id\nR1,T1,S1\nR1,T2,S2\n';
  const shapes2 = shapes + 'S2,36.11,-115.20,1\nS2,36.11,-115.17,2\n';
  const stopTimes2 = stopTimes + 'T2,ST1,1\n';
  const shared = gtfsFilesToSystemPieces({
    routes,
    trips: trips2,
    shapes: shapes2,
    stops,
    stopTimes: stopTimes2,
  });
  check(
    'a stop reachable from two shapes still becomes one station',
    shared.stations.filter((s) => s.name === 'Downtown').length === 1,
  );
  check(
    'two shapes on the same route become two patterns',
    shared.services[0].patterns.length === 2,
  );
}

// --- gtfsFilesToBatchedPieces: batching sums to the same result, even a stop shared across batches ---
{
  const routes =
    'route_id,route_short_name,route_type,route_color\nR1,101,3,E4572E\nR2,102,3,00AEEF\nR3,103,3,2ECC71\n';
  const trips = 'route_id,trip_id,shape_id\nR1,T1,S1\nR2,T2,S2\nR3,T3,S3\n';
  const shapes =
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
    'S1,36.10,-115.20,1\nS1,36.10,-115.17,2\n' +
    'S2,36.11,-115.20,1\nS2,36.11,-115.17,2\n' +
    'S3,36.12,-115.20,1\nS3,36.12,-115.17,2\n';
  // ST-shared is served by both R1 (batch 1) and R3 (batch 2, since batchSize
  // defaults to 2 — R1+R2 land in the first batch, R3 alone in the second).
  const stops =
    'stop_id,stop_name,stop_lat,stop_lon\nST-shared,Shared Stop,36.10,-115.185\nST-r2,R2 Stop,36.11,-115.185\n';
  const stopTimes = 'trip_id,stop_id,stop_sequence\nT1,ST-shared,1\nT2,ST-r2,1\nT3,ST-shared,1\n';

  const files = { routes, trips, stops, stopTimes, shapes };
  const batches = gtfsFilesToBatchedPieces(files, 2);
  check('3 routes at batch size 2 makes 2 batches', batches.length === 2);
  check("the first batch carries 2 routes' worth of ways", batches[0].ways.length === 2);
  check('the second batch carries the remaining route', batches[1].ways.length === 1);

  const batchedTotal = {
    ways: batches.flatMap((b) => b.ways),
    services: batches.flatMap((b) => b.services),
    stations: batches.flatMap((b) => b.stations),
  };
  const unbatched = gtfsFilesToSystemPieces(files);
  check(
    'batched ways total matches the unbatched pass',
    batchedTotal.ways.length === unbatched.ways.length,
  );
  check(
    'batched services total matches the unbatched pass',
    batchedTotal.services.length === unbatched.services.length,
  );
  check(
    'a stop shared across two different batches still becomes exactly one station, not two',
    batchedTotal.stations.filter((s) => s.name === 'Shared Stop').length === 1 &&
      unbatched.stations.filter((s) => s.name === 'Shared Stop').length === 1,
  );
  check(
    'batched stations total matches the unbatched pass',
    batchedTotal.stations.length === unbatched.stations.length,
  );
}

// --- keyboard: matcher, resolver, command execution, gating ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  check(
    'matchesKey is case-insensitive & reserves Ctrl',
    matchesKey(evt({ key: 'V' }), 'v') && !matchesKey(evt({ key: 'c', ctrlKey: true }), 'c'),
  );

  const ctx = {
    map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
    editor: store,
    setPanKeyHeld() {},
    openShortcuts() {},
    toggleUi() {},
  } as unknown as KeyContext;
  fresh();
  store.getState().setTool('way');
  const kc2 = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(kc2, [-115.2, 36.1]);
  store.getState().addWayPoint(kc2, [-115.1, 36.1]);
  resolveBinding(KEY_BINDINGS, evt({ key: 'Escape' }), ctx)?.run(ctx);
  check('Escape command stops the current way draw', !store.getState().activeWayId);
  resolveBinding(KEY_BINDINGS, evt({ key: 'l' }), ctx)?.run(ctx);
  check("'l' selects the way tool", store.getState().tool === 'way');
  store.getState().setSystem(store.getState().system, { readOnly: true });
  check(
    'way-tool binding gated in read-only',
    resolveBinding(KEY_BINDINGS, evt({ key: 'l' }), ctx) === null,
  );
}

// --- undo/redo: basic push/pop, redo invalidation, readOnly/empty guards ---
{
  fresh();
  check(
    'fresh system starts with nothing to undo/redo',
    !store.getState().canUndo && !store.getState().canRedo,
  );

  const stationId = store.getState().addStation([-115.2, 36.1]);
  check('adding a station is undoable', store.getState().canUndo);
  store.getState().undo();
  check(
    'undo removes the station',
    !store.getState().system.stations.some((s) => s.id === stationId),
  );
  check(
    'undo clears selection (avoids pointing at a gone/stale object)',
    store.getState().selection === null,
  );
  check('undoing the only step leaves nothing left to undo', !store.getState().canUndo);
  check('undo makes a redo available', store.getState().canRedo);

  store.getState().redo();
  check(
    'redo restores the station',
    store.getState().system.stations.some((s) => s.id === stationId),
  );
  check('redoing the only step leaves nothing left to redo', !store.getState().canRedo);

  store.getState().undo();
  store.getState().addStation([-115.3, 36.2]); // a fresh action after undo invalidates redo
  check('a new action after undo clears the redo stack', !store.getState().canRedo);

  check(
    'undo on an empty stack is a no-op, not a crash',
    (() => {
      fresh();
      store.getState().undo();
      return !store.getState().canUndo;
    })(),
  );

  fresh();
  store.getState().addStation([-115.2, 36.1]);
  store.getState().setSystem(store.getState().system, { readOnly: true });
  check(
    'loading a system (even the same one) resets history',
    !store.getState().canUndo && !store.getState().canRedo,
  );

  // Regression: setViewport (camera pan/zoom, persisted on the system for
  // sharing) must NOT create an undo step — otherwise every pan buries real
  // edits under viewport noise, and pressing Ctrl+Z mostly just un-pans.
  fresh();
  check('panning alone starts with nothing to undo', !store.getState().canUndo);
  store.getState().setViewport({ center: [-115.5, 36.5], zoom: 12 });
  check('setViewport does not create an undo step', !store.getState().canUndo);
  store.getState().addStation([-115.2, 36.1]);
  check('a real edit after panning is still undoable', store.getState().canUndo);
  store.getState().setViewport({ center: [-115.6, 36.6], zoom: 13 });
  check(
    "panning after a real edit doesn't add a second (viewport) undo step",
    (() => {
      let steps = 0;
      while (store.getState().canUndo) {
        store.getState().undo();
        steps++;
      }
      return steps === 1;
    })(),
  );
}

// --- undo/redo: gesture checkpoints coalesce into one step, discard no-ops ---
{
  fresh();
  const wayId = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.1]);
  const stepsBeforeDrag = countUndoSteps();

  store.getState().beginHistoryCheckpoint();
  store.getState().moveWayPoint(wayId, 1, [-115.05, 36.1]);
  store.getState().moveWayPoint(wayId, 1, [-115.02, 36.15]);
  store.getState().moveWayPoint(wayId, 1, [-115.0, 36.2]);
  store.getState().commitHistoryCheckpoint();
  check(
    'a whole drag (many moves) coalesces into exactly one undo step',
    countUndoSteps() === stepsBeforeDrag + 1,
  );

  const movedPoint = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  store.getState().undo();
  const revertedPoint = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  check(
    'undoing the coalesced drag reverts to before the whole drag, not one move step',
    revertedPoint[0] === -115.1 && revertedPoint[1] === 36.1 && movedPoint[0] === -115.0,
  );

  // A cancelled drag that reverts to the exact original value shouldn't
  // create a phantom undo step — this is what an Escape-cancelled gesture
  // looks like from the store's side (see interactions.ts).
  store.getState().redo();
  const stepsBeforeNoOpDrag = countUndoSteps();
  const original = store.getState().system.ways.find((w) => w.id === wayId)!.points[1];
  store.getState().beginHistoryCheckpoint();
  store.getState().moveWayPoint(wayId, 1, [-114.9, 36.3]);
  store.getState().moveWayPoint(wayId, 1, original); // the gesture's own cancel-revert
  store.getState().commitHistoryCheckpoint();
  check(
    'a checkpoint that nets no change (cancel-revert) pushes no undo step',
    countUndoSteps() === stepsBeforeNoOpDrag,
  );

  function countUndoSteps(): number {
    let n = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      n++;
    }
    for (let i = 0; i < n; i++) store.getState().redo();
    return n;
  }
}

// --- keyboard: mod (Ctrl/Cmd) bindings for undo/redo don't collide with plain ones ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  check("plain 'z' still matches the non-mod zoom-in binding", matchesKey(evt({ key: 'z' }), 'z'));
  check(
    'Ctrl+Z does not match a plain (mod-less) binding',
    !matchesKey(evt({ key: 'z', ctrlKey: true }), 'z'),
  );
  check(
    'Ctrl+Z matches a mod:true binding',
    matchesKey(evt({ key: 'z', ctrlKey: true }), 'z', true),
  );
  check(
    'plain Z (no Ctrl) does not match a mod:true binding',
    !matchesKey(evt({ key: 'z' }), 'z', true),
  );
  check(
    'Ctrl+Shift+Z does not match the mod:true/shift:false Undo binding',
    !matchesKey(evt({ key: 'z', ctrlKey: true, shiftKey: true }), 'z', true, false),
  );
  check(
    'Ctrl+Shift+Z matches the mod:true/shift:true Redo binding',
    matchesKey(evt({ key: 'z', ctrlKey: true, shiftKey: true }), 'z', true, true),
  );

  const ctx = {
    map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
    editor: store,
    setPanKeyHeld() {},
    openShortcuts() {},
    toggleUi() {},
  } as unknown as KeyContext;
  fresh();
  check(
    'Undo binding is gated by canUndo',
    resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx) === null,
  );
  store.getState().addStation([-115.2, 36.1]);
  const undone = resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx);
  check(
    "Ctrl+Z resolves to the Undo binding once there's something to undo",
    undone?.description === 'Undo',
  );
  undone?.run(ctx);
  check(
    'running the resolved Undo binding actually undoes',
    store.getState().system.stations.length === 0,
  );
  const redone = resolveBinding(
    KEY_BINDINGS,
    evt({ key: 'z', ctrlKey: true, shiftKey: true }),
    ctx,
  );
  check('Ctrl+Shift+Z resolves to the Redo binding', redone?.description === 'Redo');
  redone?.run(ctx);
  check(
    'running the resolved Redo binding actually redoes',
    store.getState().system.stations.length === 1,
  );
}

// --- keyboard: UI-hide toggle ---
{
  const evt = (o: Partial<KeyboardEvent>) => o as KeyboardEvent;
  let toggled = 0;
  const ctx = {
    map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
    editor: store,
    setPanKeyHeld() {},
    openShortcuts() {},
    toggleUi() {
      toggled++;
    },
  } as unknown as KeyContext;
  const binding = resolveBinding(KEY_BINDINGS, evt({ key: '\\' }), ctx);
  check('backslash resolves to the Show/hide UI binding', binding?.description === 'Show/hide UI');
  binding?.run(ctx);
  check('running it calls toggleUi', toggled === 1);
}

// --- marker differentiation: handles and every facility type each get a
// distinct icon, so nothing on the map collapses to an interchangeable dot ---
{
  fresh();
  const road = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(road, [-115.2, 36.1]);
  store.getState().addWayPoint(road, [-115.1, 36.1]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  const withHandles = buildFeatures(store.getState().system, null, [road], {
    viewMode: 'infrastructure',
    ...filters,
  });
  check(
    'way interior handles use the shared square control-point icon',
    withHandles.handles.features.every((f) => f.properties?.icon === HANDLE_ICON),
  );

  const iconsSeen = new Set<string>();
  for (const typeId of FACILITY_TYPE_ORDER) {
    store.getState().addFacility(typeId, [-115.15, 36.1]);
  }
  const infra = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
  });
  for (const f of infra.facilities.features) {
    const icon = f.properties?.icon as string;
    check(
      `facility "${f.properties?.typeId}" has an icon`,
      typeof icon === 'string' && icon.length > 0,
    );
    iconsSeen.add(icon);
  }
  check(
    'every facility type gets its own distinct icon (none share one)',
    iconsSeen.size === FACILITY_TYPE_ORDER.length,
  );
}

// --- performance: resolveWayPath memoizes per way object (drag perf) ---
{
  const way: Way = {
    id: 'w',
    typeId: 'lightRail',
    points: [
      [-115.2, 36.1],
      [-115.15, 36.13],
      [-115.1, 36.1],
    ],
    geometry: 'curved',
    grade: 'atGrade',
    profile: defaultProfileFor('lightRail'),
  };
  const first = resolveWayPath(way);
  const second = resolveWayPath(way);
  check(
    'resolveWayPath returns the identical cached array for the same way object',
    first === second,
  );
  const changed: Way = { ...way, points: [...way.points, [-115.05, 36.15]] };
  const third = resolveWayPath(changed);
  check(
    'resolveWayPath recomputes for a genuinely different way object',
    third !== first && third.length > first.length,
  );
}

// --- performance: only the fields buildFeatures reads force a map rebuild ---
// The live map skips its whole 14-collection rebuild when a mutation touched
// nothing renderable (core/render/featureInputs.ts) — that is what stops a
// rename, which arrives one store commit per keystroke, from re-serializing
// multi-megabyte sources. It is only safe if the "meta" half of the
// classification is actually true, so assert it by EXPERIMENT rather than by
// re-reading the table: mutate each meta field and require every collection to
// come out byte-identical. The loop is driven off FEATURE_INPUT_ROLE itself, so
// a newly added meta field with no case here fails rather than going unchecked.
{
  fresh();
  const fiRoad = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(fiRoad, [-115.2, 36.1]);
  store.getState().addWayPoint(fiRoad, [-115.1, 36.1]);
  store.getState().finishWay();
  const fiCross = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(fiCross, [-115.15, 36.05]);
  store.getState().addWayPoint(fiCross, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().formCrossingJunctions(fiCross);
  store.getState().addStation([-115.15, 36.1]);
  store.getState().addFacility(FACILITY_TYPE_ORDER[0], [-115.14, 36.11]);
  store.getState().addServiceToWay(fiRoad);
  store.getState().nameWay(fiRoad, 'Decatur Avenue');

  const fiView = {
    viewMode: 'infrastructure' as const,
    laneDetail: true,
    visibleModes: new Set(Object.keys(MODES)),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
  };
  const fiBase = store.getState().system;
  const fiRender = (s: TransitSystem) => buildFeatures(s, null, [], fiView);
  const fiCollections = (fc: ReturnType<typeof fiRender>): Record<string, string> =>
    Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, JSON.stringify(v)]));
  const fiBaseline = fiCollections(fiRender(fiBase));

  // Without this the whole block could pass vacuously: if buildFeatures emitted
  // nothing at all, every comparison below would trivially hold.
  const fiNonEmpty = Object.values(fiBaseline).filter(
    (json) => !json.includes('"features":[]'),
  ).length;
  check(
    `the rebuild-classification fixture actually renders something (${fiNonEmpty} non-empty collections)`,
    fiNonEmpty >= 4,
  );

  const fiMetaMutations: Partial<Record<keyof TransitSystem, TransitSystem>> = {
    id: { ...fiBase, id: 'some-other-id' },
    name: { ...fiBase, name: 'Renamed system' },
    description: { ...fiBase, description: 'a description' },
    viewport: { ...fiBase, viewport: { center: [-116.5, 37.2], zoom: 14 } },
    createdAt: { ...fiBase, createdAt: fiBase.createdAt + 5000 },
    updatedAt: { ...fiBase, updatedAt: fiBase.updatedAt + 5000 },
    palette: { ...fiBase, palette: ['#ff0000', '#00ff00'] },
    drivingSide: { ...fiBase, drivingSide: fiBase.drivingSide === 'right' ? 'left' : 'right' },
    vehicleKinds: {
      ...fiBase,
      vehicleKinds: [
        { id: 'vk1', modeId: 'bus', label: "40' Standard Bus", widthM: 2.6, lengthM: 12.2 },
      ],
    },
    medians: { ...fiBase, medians: { [`${fiRoad}:median`]: { widthM: 3, kindId: 'painted' } } },
    approachControls: {
      ...fiBase,
      approachControls: { [`${fiRoad}:start`]: { control: 'signal' } },
    },
  };

  for (const [key, role] of Object.entries(FEATURE_INPUT_ROLE) as [
    keyof TransitSystem,
    'render' | 'meta',
  ][]) {
    if (role !== 'meta') continue;
    // `version` is a literal type with exactly one legal value, so there is no
    // different-but-still-valid document to compare against.
    if (key === 'version') continue;
    const mutated = fiMetaMutations[key];
    if (!mutated) {
      check(`meta field "${key}" has a case in the rebuild-classification check`, false);
      continue;
    }
    const after = fiCollections(fiRender(mutated));
    const differing = Object.keys(fiBaseline).filter((c) => fiBaseline[c] !== after[c]);
    check(
      `changing ${key} rebuilds no map features, so it is safely classified meta`,
      differing.length === 0,
    );
  }

  // Positive control for the other direction: a render field really does change
  // the output, so the equality assertions above are meaningful.
  const fiMoved = fiBase.ways.map((w) =>
    w.id === fiRoad ? { ...w, points: [w.points[0], [-115.05, 36.2] as LngLat] } : w,
  );
  const fiAfterRender = fiCollections(fiRender({ ...fiBase, ways: fiMoved }));
  check(
    'changing ways does rebuild map features, so the meta assertions are not vacuous',
    Object.keys(fiBaseline).some((c) => fiBaseline[c] !== fiAfterRender[c]),
  );
}

// --- Diagram view: computeDiagramSystem snaps the graph to a schematic
// octolinear layout without losing topology or crashing on edge cases ---
{
  const angleSnapErrorRad = (
    p1: [number, number] | number[],
    p2: [number, number] | number[],
  ): number => {
    const [dx, dy] = metersFromOrigin(p1 as [number, number], p2 as [number, number]);
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    return Math.abs(angle - Math.round(angle / step) * step);
  };

  fresh();
  const dwA = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(dwA, [-115.2, 36.1]);
  store.getState().addWayPoint(dwA, [-115.1, 36.1]);
  store.getState().finishWay();
  const dwB = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(dwB, [-115.15, 36.2]);
  store.getState().addWayPoint(dwB, [-115.15, 36.1]);
  store.getState().finishWay();
  // Joins B onto A's midpoint — A gets a genuine interior node, not just an
  // endpoint junction, exercising the harder case (see joinWayPointToWay).
  store.getState().joinWayPointToWay(dwB, 1, dwA, [-115.15, 36.1]);
  const dwStationId = store.getState().addStation([-115.15, 36.15], { wayId: dwB, t: 0.5 });

  const real = store.getState().system;
  const diagram = computeDiagramSystem(real);

  check('diagram preserves the way count', diagram.ways.length === real.ways.length);
  check('diagram preserves the station count', diagram.stations.length === real.stations.length);
  check(
    'every diagram way is straight geometry',
    diagram.ways.every((w) => w.geometry === 'straight'),
  );

  const diagA = diagram.ways.find((w) => w.id === dwA)!;
  const diagB = diagram.ways.find((w) => w.id === dwB)!;
  const bJunctionCoord = diagB.points[diagB.points.length - 1];
  check(
    'the shared junction lands on the exact same schematic coordinate on both ways (no desync)',
    diagA.points.some((p) => p[0] === bJunctionCoord[0] && p[1] === bJunctionCoord[1]),
  );
  check(
    'a node-bearing way keeps an interior vertex (start, junction, end)',
    diagA.points.length === 3,
  );

  const diagStation = diagram.stations.find((s) => s.id === dwStationId)!;
  const onPath = nearestOnPath(diagB.points, diagStation.coord);
  check(
    "an anchored station still sits on its way's new schematic path",
    onPath !== null && onPath.distMeters < 1,
  );

  let maxAngleError = 0;
  for (const w of diagram.ways) {
    for (let i = 1; i < w.points.length; i++) {
      maxAngleError = Math.max(maxAngleError, angleSnapErrorRad(w.points[i - 1], w.points[i]));
    }
  }
  check('every schematic edge lands close to a 45° multiple', maxAngleError < 0.05);

  check(
    'computeDiagramSystem is memoized by system reference',
    computeDiagramSystem(real) === diagram,
  );

  const empty = createEmptySystem();
  check(
    "computeDiagramSystem on an empty system doesn't crash and stays empty",
    computeDiagramSystem(empty).ways.length === 0,
  );

  fresh();
  const soloWay = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(soloWay, [-115.2, 36.1]);
  store.getState().addWayPoint(soloWay, [-115.19, 36.1003]);
  store.getState().finishWay();
  const soloDiagram = computeDiagramSystem(store.getState().system);
  check(
    'a single unjoined way still gets a valid 2-point straightened path',
    soloDiagram.ways[0].points.length === 2,
  );
}

// --- Way tool double-click-to-finish must not place a duplicate point —
// see isDoubleClickFinish's own comment for the exact bug this guards
// against (a native double-click's second mousedown independently placing
// another point at ~the same spot the first one just did) ---
{
  check('a plain single click (detail 1) still starts a draw press', !isDoubleClickFinish(1));
  check("the double-click's second press (detail 2) is skipped", isDoubleClickFinish(2));
  check("even a rapid triple-click's third press stays skipped", isDoubleClickFinish(3));
}

// --- Draw assists are measured on screen, and stay as strong as they look --
// Both of these used to do their trigonometry directly on lng/lat. A degree
// of longitude spans only cos(latitude) as many meters as a degree of
// latitude, so that math ran in a sheared space and the assists came out
// visibly different from what they claimed to be.
{
  const VEGAS: [number, number] = [-115.166, 36.116];
  // The true on-screen angle of from→to, in degrees CCW from east.
  const screenAngle = (from: [number, number], to: [number, number]) => {
    const [dx, dy] = metersFromOrigin(from, to);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const at = (from: [number, number], angleDeg: number, meters: number) => {
    const th = (angleDeg * Math.PI) / 180;
    return offsetMeters(from, Math.cos(th) * meters, Math.sin(th) * meters);
  };

  // Was 51.07° — a diagonal the user was promised rendered 6° off it.
  for (const target of [45, 135, -45, -135]) {
    const snapped = angleSnap(VEGAS, at(VEGAS, target + 3, 2000));
    check(
      `a Shift-constrained ${target}° really renders at ${target}° on screen`,
      Math.abs(screenAngle(VEGAS, snapped) - target) < 0.01,
    );
  }
  check(
    'angle-snapping preserves the drawn length',
    Math.abs(haversineMeters(VEGAS, angleSnap(VEGAS, at(VEGAS, 48, 2000))) - 2000) < 1,
  );

  // continueStraight: `behind` sits back along the heading, so travel is due
  // east here and the assist should pull a near-east cursor onto that line.
  const behind = at(VEGAS, 180, 1000);
  const BUDGET_M = 50; // stands in for STRAIGHT_SNAP_PX * metersPerPixel()

  check(
    'a cursor right on the heading continues straight',
    continueStraight(VEGAS, behind, at(VEGAS, 0, 1000), BUDGET_M) !== null,
  );
  check(
    'a cursor just inside the budget still snaps',
    continueStraight(VEGAS, behind, at(VEGAS, 2.5, 1000), BUDGET_M) !== null,
  );
  check(
    'a deliberate turn is left alone',
    continueStraight(VEGAS, behind, at(VEGAS, 30, 1000), BUDGET_M) === null,
  );
  check(
    'dragging backwards never folds the line over itself',
    continueStraight(VEGAS, behind, at(VEGAS, 175, 1000), BUDGET_M) === null,
  );

  // The regression that made this feel like the tool overriding you: with an
  // ANGLE cone, the same slight angle snapped harder the longer you drew, so
  // a long line drawn a couple of degrees off went bolt straight. With a
  // distance gate, drawing further only makes the assist easier to escape.
  const SLIGHT = 4; // degrees off the heading — inside the old 10° cone
  check(
    'a slight angle still snaps when the extension is short',
    continueStraight(VEGAS, behind, at(VEGAS, SLIGHT, 300), BUDGET_M) !== null,
  );
  check(
    'the same slight angle drawn far does NOT get yanked straight',
    continueStraight(VEGAS, behind, at(VEGAS, SLIGHT, 3000), BUDGET_M) === null,
  );

  // Whatever the assist does accept, it never moves the point further than
  // the budget — that is what makes "as strong as it looks" true.
  for (const deg of [0.5, 1, 2, 3, 5, 8]) {
    for (const dist of [200, 800, 2500, 6000]) {
      const raw = at(VEGAS, deg, dist);
      const got = continueStraight(VEGAS, behind, raw, BUDGET_M);
      if (got && haversineMeters(raw, got) > BUDGET_M + 1) {
        check(
          `the straight assist never moves a point more than its budget (${deg}° @ ${dist}m)`,
          false,
        );
      }
    }
  }
  check('the straight assist never moves a point further than its budget', true);

  // Direction-independence: the old degree-space cone was 8.10° wide heading
  // east but 12.31° heading north, so the assist was quietly stronger in some
  // directions than others. Measure the widest deviation still accepted at a
  // fixed distance and require every heading to agree.
  const widestAccepted = (headingDeg: number) => {
    const back = at(VEGAS, headingDeg + 180, 1000);
    let widest = 0;
    for (let a = 0; a <= 20; a += 0.01) {
      if (continueStraight(VEGAS, back, at(VEGAS, headingDeg + a, 1000), BUDGET_M)) widest = a;
    }
    return widest;
  };
  const cones = [0, 45, 90, 135, 270].map(widestAccepted);
  check(
    'the straight assist is equally strong in every direction',
    Math.max(...cones) - Math.min(...cones) < 0.05,
  );
}

// --- A press that moves does not eat the NEXT click -----------------------
// Gestures that handle their own node placement set an internal
// `suppressClick` flag so onClick doesn't then act on the same press a
// second time. The flag is cleared by the click it was meant to suppress —
// but MapLibre only fires `click` when the pointer stayed within its
// clickTolerance (3px by default) between mousedown and mouseup; past that
// it drops the event outright (see maplibre-gl's own ui/handler/map_event.ts,
// `click()`). So a press with any real movement in it left the flag armed
// with no click coming to clear it, and the user's NEXT genuine click was
// swallowed instead — reproduced live as click/nothing/click while trying to
// start a light rail line, and felt random because whether it happens is
// just whether your hand moved 3 pixels.
{
  // MapLibre's default; the exact value doesn't matter here, only that a
  // press past it produces no `click` at all.
  const CLICK_TOLERANCE_PX = 3;

  interface FakePoint {
    x: number;
    y: number;
  }

  const CENTER_LNG = -115.17;
  const CENTER_LAT = 36.1;
  const CENTER_PX = { x: 640, y: 360 };
  // Matches getZoom() === 14 at CENTER_LAT: 156543.03392 * cos(lat) / 2**14.
  const M_PER_PX = (156543.03392 * Math.cos((CENTER_LAT * Math.PI) / 180)) / 2 ** 14;
  const DEG_PER_PX_LAT = M_PER_PX / 111_320;
  const DEG_PER_PX_LNG = M_PER_PX / (111_320 * Math.cos((CENTER_LAT * Math.PI) / 180));

  /**
   * The slice of the MapLibre map surface attachInteractions actually uses,
   * with the one behavior this test turns on — `click` suppressed for a moved
   * press — reproduced exactly as MapLibre does it.
   */
  function createFakeMap() {
    const handlers = new Map<string, Set<(e: unknown) => void>>();
    // Layer-scoped registrations (map.on(type, layer, fn)) are hover cursor
    // plumbing; they never participate in click dispatch, so they're dropped.
    const key = (type: string) => type;
    const canvas = {
      style: { cursor: '' },
      addEventListener() {},
      removeEventListener() {},
    };
    // Records what each GeoJSON source was last given, so a test can read the
    // rubber band back out exactly as the map would draw it.
    const sourceData = new Map<
      string,
      { features: { geometry: { coordinates: [number, number][] } }[] }
    >();
    const map = {
      sourceData,
      getCanvas: () => canvas,
      getCenter: () => ({ lat: 36.1, lng: -115.17 }),
      getZoom: () => 14,
      getLayer: () => undefined,
      getSource: (id: string) => ({ setData: (d: never) => sourceData.set(id, d) }),
      queryRenderedFeatures: () => [],
      // A flat local projection centered on Las Vegas, scaled to agree with
      // the metersPerPixel() the code computes from getCenter()/getZoom()
      // above. It has to be geographically faithful, not merely invertible:
      // the draw assists work in meters, so a projection that (say) lands
      // every test point up near the pole makes cos(latitude) collapse and
      // the geometry it measures meaningless.
      project: (c: [number, number]): FakePoint => ({
        x: CENTER_PX.x + (c[0] - CENTER_LNG) / DEG_PER_PX_LNG,
        y: CENTER_PX.y - (c[1] - CENTER_LAT) / DEG_PER_PX_LAT,
      }),
      unproject: (p: FakePoint): { lng: number; lat: number } => ({
        lng: CENTER_LNG + (p.x - CENTER_PX.x) * DEG_PER_PX_LNG,
        lat: CENTER_LAT - (p.y - CENTER_PX.y) * DEG_PER_PX_LAT,
      }),
      panBy() {},
      on(type: string, a: unknown, b?: unknown) {
        const fn = (typeof a === 'function' ? a : b) as (e: unknown) => void;
        if (typeof a !== 'function') return; // layer-scoped hover handler
        const set = handlers.get(key(type)) ?? new Set();
        set.add(fn);
        handlers.set(key(type), set);
      },
      once(type: string, fn: (e: unknown) => void) {
        const wrapped = (e: unknown) => {
          handlers.get(key(type))?.delete(wrapped);
          fn(e);
        };
        map.on(type, wrapped);
      },
      off(type: string, a: unknown, b?: unknown) {
        if (typeof a !== 'function') return;
        handlers.get(key(type))?.delete(a as (e: unknown) => void);
        void b;
      },
      fire(type: string, e: unknown) {
        for (const fn of [...(handlers.get(key(type)) ?? [])]) fn(e);
      },
    };
    return map;
  }

  const mouseEvent = (pt: FakePoint, map: ReturnType<typeof createFakeMap>) => ({
    point: pt,
    lngLat: map.unproject(pt),
    originalEvent: {
      button: 0,
      detail: 1,
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    },
    preventDefault() {},
  });

  /**
   * One press, dispatched the way the browser and MapLibre actually dispatch
   * it: mousedown and mouseup always, `click` only when the pointer stayed
   * inside the tolerance.
   */
  function press(map: ReturnType<typeof createFakeMap>, from: FakePoint, dx = 0, dy = 0) {
    const to = { x: from.x + dx, y: from.y + dy };
    map.fire('mousedown', mouseEvent(from, map));
    if (dx !== 0 || dy !== 0) map.fire('mousemove', mouseEvent(to, map));
    map.fire('mouseup', mouseEvent(to, map));
    if (Math.hypot(dx, dy) < CLICK_TOLERANCE_PX) map.fire('click', mouseEvent(to, map));
  }

  interface BrowserGlobals {
    window?: unknown;
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  }
  const g = globalThis as BrowserGlobals;
  const originalGlobals: BrowserGlobals = {
    window: g.window,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
  };
  g.window = { addEventListener() {}, removeEventListener() {} };
  // Hover/preview work is rAF-throttled, so the tests need frames to exist.
  // The callback must NOT run before requestAnimationFrame returns: rafThrottle
  // stores the id it hands back and treats a non-null id as "a flush is already
  // scheduled". Running the callback inline meant that assignment happened
  // after the flush, leaving the throttle permanently convinced a frame was
  // pending — it flushed once and then silently swallowed every later call.
  // Queue here, and let the test pump frames explicitly.
  let frameId = 0;
  let frames = new Map<number, () => void>();
  g.requestAnimationFrame = (fn: () => void) => {
    const id = ++frameId;
    frames.set(id, fn);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => frames.delete(id);
  /** Run everything currently scheduled, as one frame boundary. */
  const pumpFrames = () => {
    const due = frames;
    frames = new Map();
    for (const fn of due.values()) fn();
  };
  try {
    const run = (presses: [number, number][]) => {
      const s = createEditorStore();
      s.getState().setSystem(createEmptySystem());
      s.getState().setTool('station');
      const map = createFakeMap();
      const detach = attachInteractions(map as never, s, {
        openShortcuts() {},
        toggleUi() {},
        isDiagramMode: () => false,
        isNetworkMode: () => true,
        focusFootprint() {},
      });
      const added: number[] = [];
      let x = 400;
      for (const [dx, dy] of presses) {
        const before = s.getState().system.stations.length;
        press(map, { x, y: 300 }, dx, dy);
        added.push(s.getState().system.stations.length - before);
        x += 40; // never place two stations on the same spot
      }
      detach();
      return added;
    };

    // Baseline: still-hand clicks each place a station, which is what makes
    // the failure below a regression in the moved-press case specifically and
    // not the station tool being broken generally.
    check(
      'consecutive still clicks each place a station',
      JSON.stringify(
        run([
          [0, 0],
          [0, 0],
          [0, 0],
        ]),
      ) === '[1,1,1]',
    );

    // The bug. A moved press still places its own station (its mousedown/
    // mouseup gesture handles that itself) — what regressed is the press
    // AFTER it, which used to place nothing at all. Measured against the real
    // MapLibre build before the fix, this was [1, 0].
    check(
      'a click right after a moved press still places a station',
      JSON.stringify(
        run([
          [8, 0],
          [0, 0],
        ]),
      ) === '[1,1]',
    );

    // The user-visible shape of it: click, click, nothing, click — every
    // press works except the one following the press that moved. Before the
    // fix this was [1, 1, 0, 1].
    check(
      'a moved press never leaves a later click silently doing nothing',
      JSON.stringify(
        run([
          [0, 0],
          [8, 0],
          [0, 0],
          [0, 0],
        ]),
      ) === '[1,1,1,1]',
    );

    // --- What you see is what you get -------------------------------------
    // The rubber band is a promise about the geometry the next release will
    // create, so it has to be drawn through the SAME resolveEnd the release
    // commits with. It used to be drawn to the raw cursor instead, so every
    // draw assist that moved the point — continue-straight above all — left
    // the preview showing one line and the committed way rendering a
    // different one, with nothing on screen saying the assist had grabbed.
    {
      const s = createEditorStore();
      s.getState().setSystem(createEmptySystem());
      s.getState().setTool('way');
      const map = createFakeMap();
      const detach = attachInteractions(map as never, s, {
        openShortcuts() {},
        toggleUi() {},
        isDiagramMode: () => false,
        isNetworkMode: () => false,
        focusFootprint() {},
      });

      // Two presses lay a way running due east, which gives it a heading for
      // continue-straight to work from.
      press(map, { x: 400, y: 300 });
      press(map, { x: 600, y: 300 });

      // Hover, read the rubber band, then release at the SAME point and read
      // what actually got committed. Any gap between them is a broken promise.
      const gapAt = (pt: FakePoint) => {
        map.fire('mousemove', mouseEvent(pt, map));
        pumpFrames(); // the rubber band is written on the frame, not the event
        const preview = map.sourceData.get(SRC_PREVIEW);
        const band = preview?.features?.[0]?.geometry?.coordinates;
        const shown = band?.[band.length - 1];
        press(map, pt);
        const way = s.getState().system.ways[0];
        const committed = way.points[way.points.length - 1];
        if (!shown) return null;
        return haversineMeters(shown as [number, number], committed);
      };

      // A hair off the heading: continue-straight grabs, so the preview has to
      // show the straightened point, not the cursor.
      const insideAssist = gapAt({ x: 800, y: 302 });
      check('the rubber band is drawn at all while extending', insideAssist !== null);
      check(
        'preview matches what gets committed when the straight-assist grabs',
        insideAssist !== null && insideAssist < 0.01,
      );

      // A deliberate turn: no assist, so preview and commit trivially agree —
      // worth pinning so a future "preview the raw cursor" shortcut can't pass
      // by only ever being tested outside the assist zone.
      const clearTurn = gapAt({ x: 900, y: 560 });
      check(
        'preview matches what gets committed on a deliberate turn',
        clearTurn !== null && clearTurn < 0.01,
      );

      detach();
    }

    // The rubber band has to promise the right SHAPE, not just the right end
    // point. Draft geometry is "curved" by default, so committing a point
    // rounds the corner at the previous endpoint — which, until that moment,
    // is an unfilleted line end. A straight two-point band showed a sharp
    // corner and then rendered a curve through it.
    {
      const s = createEditorStore();
      s.getState().setSystem(createEmptySystem());
      s.getState().setTool('way');
      const map = createFakeMap();
      const detach = attachInteractions(map as never, s, {
        openShortcuts() {},
        toggleUi() {},
        isDiagramMode: () => false,
        isNetworkMode: () => false,
        focusFootprint() {},
      });

      press(map, { x: 400, y: 300 });
      press(map, { x: 600, y: 300 });

      // Hover somewhere that turns a clear corner, and capture the band.
      map.fire('mousemove', mouseEvent({ x: 700, y: 560 }, map));
      pumpFrames();
      const band = map.sourceData.get(SRC_PREVIEW)?.features?.[0]?.geometry?.coordinates ?? [];
      check(
        'a curved draft previews its rounded corner, not a bare two-point line',
        band.length > 2,
      );

      // Commit it, then resolve the way exactly as the map renders it. The
      // band must lie on that rendered path.
      press(map, { x: 700, y: 560 });
      const rendered = resolveWayPath(s.getState().system.ways[0]);
      const offPath = band.map((p) => {
        const near = nearestOnPath(rendered, p as [number, number]);
        return near ? near.distMeters : Infinity;
      });
      check(
        "every previewed point lies on the committed way's rendered path",
        offPath.length > 0 && Math.max(...offPath) < 0.01,
      );

      // And the corner really is rounded rather than the band merely being
      // subdivided along a straight line — otherwise the check above would
      // pass on a preview that still promised a sharp corner.
      const sharp = [
        [400, 300],
        [600, 300],
        [700, 560],
      ].map(([x, y]) => map.unproject({ x, y }));
      const cornerCut = nearestOnPath(rendered, [sharp[1].lng, sharp[1].lat]);
      check(
        'the committed corner really is filleted away from the control point',
        (cornerCut?.distMeters ?? 0) > 1,
      );

      detach();
    }
  } finally {
    Object.assign(g, originalGlobals);
  }
}

// ===========================================================================
// R1: lane-level cross-sections, junction semantics, shared identity
// ===========================================================================

// --- catalog: every way type carries lane data; no hardcoded kinds ---
{
  for (const type of Object.values(WAY_TYPES)) {
    check(`way type "${type.id}" has a default profile`, type.defaultProfile.length > 0);
    check(
      `way type "${type.id}"'s default profile only uses its allowed lane kinds`,
      type.defaultProfile.every((l) => type.laneKindIds.includes(l.kindId)),
    );
    check(
      `way type "${type.id}"'s primary lane kind is allowed`,
      type.laneKindIds.includes(type.primaryLaneKindId),
    );
    check(
      `way type "${type.id}"'s default profile capacity matches its defaultCapacity`,
      laneCapacity(buildProfile(type.defaultProfile)) === type.defaultCapacity,
    );
    check(
      `way family "${type.family}" has an identity noun`,
      WAY_FAMILIES[type.family].identityNoun.length > 0,
    );
  }
  for (const preset of Object.values(PROFILE_PRESETS)) {
    const type = WAY_TYPES[preset.wayTypeId];
    check(`preset "${preset.id}" targets a real way type`, !!type);
    check(
      `preset "${preset.id}" only uses lane kinds its way type allows`,
      preset.lanes.every((l) => type.laneKindIds.includes(l.kindId)),
    );
  }
  check('road offers profile presets', profilePresetsForWayType('road').length >= 5);
  check(
    'pedestrian way type exists (pedestrian-only paths are a catalog entry)',
    !!WAY_TYPES.pedestrian,
  );
  check(
    'pedestrian default profile is a walking lane, not a special case',
    WAY_TYPES.pedestrian.defaultProfile[0].kindId === 'sidewalk',
  );
}

// --- profile ops ---
{
  const road = defaultProfileFor('road', 4);
  check('defaultProfileFor(road, 4) carries 4 counted lanes', laneCapacity(road) === 4);
  check(
    'default 4-lane road splits 2 backward / 2 forward',
    travelLanes(road).filter((l) => l.direction === 'forward' && l.kindId === 'drive').length === 2,
  );
  check(
    'lane ids are unique within a profile',
    new Set(road.lanes.map((l) => l.id)).size === road.lanes.length,
  );
  check(
    'profile width sums lane widths',
    Math.abs(profileWidthM(road) - road.lanes.reduce((s, l) => s + l.widthM, 0)) < 1e-9,
  );

  const odd = defaultProfileFor('road', 5);
  check(
    'odd capacity puts the extra lane forward',
    odd.lanes.filter((l) => l.kindId === 'drive' && l.direction === 'forward').length === 3,
  );
  const single = defaultProfileFor('road', 1);
  check(
    'capacity 1 becomes one bidirectional lane',
    travelLanes(single)
      .filter((l) => l.kindId === 'drive')
      .every((l) => l.direction === 'both'),
  );

  const flipped = flipProfile(road);
  check(
    'flipProfile reverses lane order',
    flipped.lanes[0].id === road.lanes[road.lanes.length - 1].id,
  );
  check(
    'flipProfile swaps directions',
    flipped.lanes.every((l) => {
      const orig = road.lanes.find((o) => o.id === l.id)!;
      return orig.direction === 'forward'
        ? l.direction === 'backward'
        : orig.direction === 'backward'
          ? l.direction === 'forward'
          : l.direction === orig.direction;
    }),
  );
  check(
    'flipProfile twice is identity',
    JSON.stringify(flipProfile(flipped)) === JSON.stringify(road),
  );

  const oneWay = makeOneWay(road, 'forward');
  check('makeOneWay makes every travel lane forward', isOneWay(oneWay));
  check(
    'makeOneWay leaves separators/edges alone',
    oneWay.lanes.filter((l) => l.kindId === 'sidewalk').every((l) => l.direction === 'both'),
  );
  const twoWay = makeTwoWay(oneWay);
  check(
    'makeTwoWay restores a directional split',
    !isOneWay(twoWay) && travelLanes(twoWay).some((l) => l.direction === 'backward'),
  );

  const widened = withLaneCount(road, 'road', 6);
  check('withLaneCount grows to the target', laneCapacity(widened) === 6);
  const fwd6 = widened.lanes.filter(
    (l) => l.kindId === 'drive' && l.direction === 'forward',
  ).length;
  check('withLaneCount keeps the directional split balanced', fwd6 === 3);
  const narrowed = withLaneCount(widened, 'road', 2);
  check('withLaneCount shrinks to the target', laneCapacity(narrowed) === 2);
  check('withLaneCount(1) floors at one lane', laneCapacity(withLaneCount(road, 'road', 0)) === 1);
  const oneWayWidened = withLaneCount(
    makeOneWay(defaultProfileFor('road', 2), 'forward'),
    'road',
    3,
  );
  check(
    'widening a one-way road stays one-way',
    isOneWay(oneWayWidened) && laneCapacity(oneWayWidened) === 3,
  );
}

// --- carriageway separation / combination (profile level) ---
{
  const boulevard = buildProfile(PROFILE_PRESETS.roadBoulevard.lanes);
  const sep = separateProfiles(boulevard)!;
  check('separateProfiles splits a divided boulevard', !!sep);
  check(
    'forward carriageway is one-way forward',
    isOneWay(sep.forward) && directionalLanes(sep.forward).every((l) => l.direction === 'forward'),
  );
  check(
    'backward carriageway is one-way backward',
    directionalLanes(sep.backward).every((l) => l.direction === 'backward'),
  );
  check(
    'the median itself is dropped (the physical gap replaces it)',
    [...sep.forward.lanes, ...sep.backward.lanes].every((l) => l.kindId !== 'median'),
  );
  check(
    "each carriageway keeps its own side's bike lane",
    sep.forward.lanes.some((l) => l.kindId === 'bike') &&
      sep.backward.lanes.some((l) => l.kindId === 'bike'),
  );
  check(
    'separateProfiles refuses a one-way profile',
    separateProfiles(makeOneWay(boulevard, 'forward')) === null,
  );

  const recombined = combineProfiles(sep.backward, sep.forward);
  check(
    'combineProfiles restores two-way travel',
    !isOneWay(recombined) &&
      travelLanes(recombined).some((l) => l.direction === 'forward') &&
      travelLanes(recombined).some((l) => l.direction === 'backward'),
  );
  check(
    'combineProfiles inserts a median between the halves',
    recombined.lanes.some((l) => l.kindId === 'median'),
  );
  const recombinedKind = combineProfiles(sep.backward, sep.forward, 5, 'railReservation');
  check(
    'combineProfiles accepts a captured width/kind instead of the catalog default',
    recombinedKind.lanes.some((l) => l.kindId === 'railReservation' && l.widthM === 5),
  );
}

// --- ECS-shaped component registry (model/components.ts) ---
{
  const empty: Record<string, { n: number }> = {};
  const withA = withComponent(empty, 'a', { n: 1 });
  check(
    'withComponent adds without mutating the original map',
    empty.a === undefined && withA.a?.n === 1,
  );
  check('getComponent reads a present key', getComponent(withA, 'a')?.n === 1);
  check('getComponent reads an absent key as undefined', getComponent(withA, 'b') === undefined);
  const withB = withComponent(withA, 'b', { n: 2 });
  const withoutA = withoutComponent(withB, 'a');
  check(
    'withoutComponent removes only the given key',
    withoutA.a === undefined && withoutA.b?.n === 2,
  );
  check(
    'withoutComponent on an absent key is a no-op (same reference)',
    withoutComponent(withB, 'z') === withB,
  );
  check(
    'laneRefKey/armRefKey format lane and arm references',
    laneRefKey('w1', 'l1') === 'w1:l1' && armRefKey('w1', 'start') === 'w1:start',
  );
}

// --- driving side (model/profile.ts) — target-way/kind identity, never an
// angle bucket, is what makes turn restrictions robust; drivingSide is the
// one place actual left/right geometry matters, and it's isolated to these
// three functions. ---
{
  // separateProfiles: which array-half becomes which carriageway flips.
  const customProfile: CrossSection = {
    lanes: [
      { id: 's1', kindId: 'shoulder', widthM: 2, direction: 'none' },
      { id: 'd1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'd2', kindId: 'drive', widthM: 3.3, direction: 'forward' },
      { id: 'p1', kindId: 'parking', widthM: 2, direction: 'none' },
    ],
  };
  const rightSep = separateProfiles(customProfile, 'right')!;
  const leftSep = separateProfiles(customProfile, 'left')!;
  check(
    'separateProfiles(right): backward carriageway keeps the array-left half',
    rightSep.backward.lanes.some((l) => l.kindId === 'shoulder') &&
      rightSep.forward.lanes.some((l) => l.kindId === 'parking'),
  );
  check(
    'separateProfiles(left): mirrored — forward carriageway keeps the array-left half',
    leftSep.forward.lanes.some((l) => l.kindId === 'shoulder') &&
      leftSep.backward.lanes.some((l) => l.kindId === 'parking'),
  );

  // makeTwoWay: which half gets which direction flips.
  const oneWay4 = makeOneWay(defaultProfileFor('road', 4), 'forward');
  const rightTwoWay = makeTwoWay(oneWay4, 'right');
  const leftTwoWay = makeTwoWay(oneWay4, 'left');
  const rightDirs = directionalLanes(rightTwoWay).map((l) => l.direction);
  const leftDirs = directionalLanes(leftTwoWay).map((l) => l.direction);
  check(
    'makeTwoWay(right) puts backward lanes first (array-left)',
    rightDirs[0] === 'backward' && rightDirs[rightDirs.length - 1] === 'forward',
  );
  check(
    'makeTwoWay(left) mirrors: forward lanes first',
    leftDirs[0] === 'forward' && leftDirs[leftDirs.length - 1] === 'backward',
  );
  check(
    'makeTwoWay driving side changes direction assignment only, not lane count',
    rightTwoWay.lanes.length === leftTwoWay.lanes.length,
  );
  check(
    'makeTwoWay defaults to right-hand traffic (matches pre-existing behavior)',
    JSON.stringify(makeTwoWay(oneWay4).lanes) === JSON.stringify(rightTwoWay.lanes),
  );

  // withLaneCount: which side a new lane inserts on flips.
  const twoLane: CrossSection = {
    lanes: [
      { id: 'b1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'f1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
    ],
  };
  const grownRight = withLaneCount(twoLane, 'road', 3, 'right');
  const grownLeft = withLaneCount(twoLane, 'road', 3, 'left');
  check(
    'withLaneCount(right) inserts the new forward lane at the end',
    grownRight.lanes[0].id === 'b1' &&
      grownRight.lanes[grownRight.lanes.length - 1].direction === 'forward' &&
      grownRight.lanes[grownRight.lanes.length - 1].id !== 'f1',
  );
  check(
    'withLaneCount(left) mirrors: inserts the new forward lane at the front',
    grownLeft.lanes[0].direction === 'forward' &&
      grownLeft.lanes[0].id !== 'f1' &&
      grownLeft.lanes.some((l) => l.id === 'b1'),
  );
}

// --- offsetPolyline (the carriageway/lane offset primitive) ---
{
  const line: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]; // due east
  const right = offsetPolyline(line, 10);
  const [, dyMeters] = [0, (right[0][1] - line[0][1]) * 111320];
  check(
    'offsetPolyline(+) shifts right of travel (south when heading east)',
    dyMeters < -9 && dyMeters > -11,
  );
  const left = offsetPolyline(line, -10);
  check('offsetPolyline(−) shifts left of travel', (left[0][1] - line[0][1]) * 111320 > 9);
  const bent: LngLat[] = [
    [-115.2, 36.1],
    [-115.15, 36.1],
    [-115.15, 36.15],
  ];
  const bentOff = offsetPolyline(bent, 5);
  check('offsetPolyline keeps the vertex count', bentOff.length === bent.length);

  // A wide offset toward the inside of a TIGHT curve (offset > radius) used to
  // fold back on itself — the "carriageway spike" where a wide road follows a
  // freeway ramp / tight junction. The de-loop drops the collapsed run so the
  // inner edge pinches straight across the corner instead of looping.
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
  check(
    'offsetPolyline de-loops a wide offset on a tight curve (no inner-corner spike)',
    reversals === 0,
  );
}

// --- v6 migration: capacity+class → profile; round-trips ---
{
  const v5ish = parseSystem({
    version: 5,
    id: 'm',
    name: 'm',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      {
        id: 'r',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        capacity: 6,
        classId: 'arterial',
      },
      {
        id: 't',
        typeId: 'heavyRail',
        points: [
          [-115.2, 36.2],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        capacity: 2,
      },
    ],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  });
  check('v5 road capacity 6 migrates to a 6-lane profile', wayCapacity(v5ish.ways[0]) === 6);
  check(
    "migrated road keeps sidewalks from the type's default profile",
    v5ish.ways[0].profile.lanes.some((l) => l.kindId === 'sidewalk'),
  );
  check(
    'v5 rail capacity 2 migrates to a 2-track profile',
    wayCapacity(v5ish.ways[1]) === 2 &&
      v5ish.ways[1].profile.lanes.every((l) => l.kindId === 'track'),
  );
  check(
    'migrated system lands on the current schema version',
    v5ish.version === createEmptySystem().version,
  );
  check(
    'migrated system has an empty namedWays list',
    Array.isArray(v5ish.namedWays) && v5ish.namedWays.length === 0,
  );

  const round = parseSystem(JSON.parse(JSON.stringify(v5ish)));
  check(
    'v6 profile round-trips exactly',
    JSON.stringify(round.ways[0].profile) === JSON.stringify(v5ish.ways[0].profile),
  );

  // Node control/connectors round-trip, with bad connectors dropped.
  const laneA = v5ish.ways[0].profile.lanes[1].id;
  const laneB = v5ish.ways[1].profile.lanes[0].id;
  const withNode = {
    ...JSON.parse(JSON.stringify(v5ish)),
    ways: JSON.parse(JSON.stringify(v5ish.ways)).map((w: Way) => ({
      ...w,
      points: [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ],
    })),
    nodes: [
      {
        id: 'n1',
        coord: [-115.2, 36.1],
        refs: [
          { wayId: 'r', pointIndex: 0 },
          { wayId: 't', pointIndex: 0 },
        ],
        control: 'signal',
        connectors: [
          { from: { wayId: 'r', laneId: laneA }, to: { wayId: 't', laneId: laneB } },
          { from: { wayId: 'r', laneId: 'nope' }, to: { wayId: 't', laneId: laneB } },
        ],
      },
    ],
  };
  const parsedNode = parseSystem(withNode).nodes[0];
  check('node control round-trips', parsedNode?.control === 'signal');
  check('valid lane connectors round-trip', parsedNode?.connectors?.length === 1);
  check(
    'connectors naming unknown lanes are dropped',
    !parsedNode?.connectors?.some((c) => c.from.laneId === 'nope'),
  );
}

// --- vehicle catalogs: serialize migration ---
{
  const legacy = parseSystem({
    version: 8,
    id: 'v8sys',
    name: 'V8',
    viewport: { center: [-115.17, 36.11], zoom: 12 },
    createdAt: 1,
    updatedAt: 1,
    ways: [],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    palette: [],
    drivingSide: 'right',
    turnRestrictions: {},
    medians: {},
    approachControls: {},
  });
  check(
    'a v8 system migrates with an empty vehicleKinds list',
    Array.isArray(legacy.vehicleKinds) && legacy.vehicleKinds.length === 0,
  );
  check('a v8 system migrates to the current version', legacy.version === 9);

  const withKinds = parseSystem({
    ...legacy,
    vehicleKinds: [
      {
        id: 'vk1',
        modeId: 'bus',
        label: 'Articulated bus',
        widthM: 2.6,
        lengthM: 18,
        topSpeedKmh: 60,
      },
      { id: 'vk-bad', modeId: 'bus' }, // missing widthM/lengthM — dropped, not thrown
    ],
  });
  check(
    'a well-formed vehicle kind round-trips',
    withKinds.vehicleKinds.length === 1 && withKinds.vehicleKinds[0].label === 'Articulated bus',
  );

  check(
    'createEmptySystem starts with an empty vehicle-kind list',
    createEmptySystem().vehicleKinds.length === 0,
  );
}

// --- vehicle catalogs: store actions ---
{
  fresh();
  const wayId = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.19, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftMode('bus');
  const serviceId = store.getState().addServiceToWay(wayId)!;

  store
    .getState()
    .setVehicleKinds([{ id: 'vk1', modeId: 'bus', label: 'Test bus', widthM: 2.6, lengthM: 12 }]);
  check(
    "setVehicleKinds replaces the system's whole list",
    store.getState().system.vehicleKinds.length === 1,
  );

  store.getState().setServiceVehicleKind(serviceId, 'vk1');
  check(
    'setServiceVehicleKind assigns a kind to a service',
    store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId === 'vk1',
  );

  store.getState().setServiceVehicleKind(serviceId, undefined);
  check(
    'setServiceVehicleKind(undefined) clears the assignment',
    store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId === undefined,
  );
}

// --- store: profile editing, presets ---
{
  fresh();
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(r, 'roadBoulevard');
  const way = store.getState().system.ways.find((w) => w.id === r)!;
  check(
    "applyProfilePreset installs the preset's lanes",
    way.profile.lanes.some((l) => l.kindId === 'median') &&
      way.profile.lanes.some((l) => l.kindId === 'bike'),
  );
  check("applyProfilePreset takes the preset's class", way.classId === 'arterial');
  const custom = {
    lanes: way.profile.lanes.map((l) => (l.kindId === 'drive' ? { ...l, widthM: 3.05 } : l)),
  };
  store.getState().setWayProfile(r, custom);
  check(
    'setWayProfile replaces the cross-section',
    store
      .getState()
      .system.ways.find((w) => w.id === r)!
      .profile.lanes.every((l) => l.kindId !== 'drive' || l.widthM === 3.05),
  );
}

// --- store: shared identity (NamedWay) ---
{
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  const b = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(b, [-115.2, 36.11]);
  store.getState().addWayPoint(b, [-115.1, 36.11]);
  store.getState().finishWay();

  store.getState().nameWay(a, 'Decatur Avenue');
  check(
    'naming a way creates a shared identity',
    store
      .getState()
      .system.namedWays.some((n) => n.name === 'Decatur Avenue' && n.wayIds.includes(a)),
  );
  store.getState().nameWay(b, 'Decatur Avenue');
  check(
    'naming a second way with the same name joins the identity',
    store.getState().system.namedWays.filter((n) => n.name === 'Decatur Avenue').length === 1 &&
      store.getState().system.namedWays[0].wayIds.length === 2,
  );
  store.getState().nameWay(a, 'Decatur Ave');
  check(
    'renaming through one member renames the shared identity',
    store.getState().system.namedWays[0].name === 'Decatur Ave' &&
      store.getState().system.namedWays[0].wayIds.length === 2,
  );
  store.getState().nameWay(b, '');
  check(
    'an empty name removes the way from its identity',
    !store.getState().system.namedWays[0]?.wayIds.includes(b),
  );
  store.getState().deleteWay(a);
  check(
    'deleting the last member deletes the identity',
    store.getState().system.namedWays.length === 0,
  );
}

// --- store: identity survives splitting (a street cut by an intersection) ---
{
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().nameWay(a, 'Charleston Blvd');
  store.getState().splitWayAt(a, 1);
  const nw = store.getState().system.namedWays[0];
  check(
    'both split halves stay under the one identity',
    nw.wayIds.length === 2 && store.getState().system.ways.every((w) => nw.wayIds.includes(w.id)),
  );
}

// --- store: mergeWays (inverse of split) ---
{
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(a, 1);
  const halves = store.getState().system.ways.map((w) => w.id);
  check('split made two ways', halves.length === 2);
  store.getState().mergeWays(halves[0], halves[1]);
  const merged = store.getState().system;
  check('mergeWays restores one way', merged.ways.length === 1 && merged.ways[0].id === halves[0]);
  check('merged way has the full point run', merged.ways[0].points.length === 3);
  check('the seam node dissolves (no third way met there)', merged.nodes.length === 0);
  check(
    'the riding service runs over just the merged way',
    merged.services.every((sv) =>
      sv.patterns.every((p) => p.wayIds.length === 1 && p.wayIds[0] === halves[0]),
    ),
  );
  // Merging two ways that don't touch is refused.
  fresh();
  const x = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(x, [-115.2, 36.1]);
  store.getState().addWayPoint(x, [-115.18, 36.1]);
  store.getState().finishWay();
  const y = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(y, [-115.1, 36.2]);
  store.getState().addWayPoint(y, [-115.08, 36.2]);
  store.getState().finishWay();
  store.getState().mergeWays(x, y);
  check(
    "mergeWays refuses ways that don't share an endpoint",
    store.getState().system.ways.length === 2,
  );
}

// --- store: separate/combine carriageways ---
{
  fresh();
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(r, 'roadArterial4');
  const newId = store.getState().separateCarriageways(r)!;
  check(
    'separateCarriageways returns the new carriageway',
    !!newId && store.getState().system.ways.length === 2,
  );
  const fwd = store.getState().system.ways.find((w) => w.id === r)!;
  const back = store.getState().system.ways.find((w) => w.id === newId)!;
  check(
    'original way becomes the one-way forward carriageway',
    isOneWay(fwd.profile) && directionalLanes(fwd.profile).every((l) => l.direction === 'forward'),
  );
  check(
    'new way is the one-way backward carriageway',
    directionalLanes(back.profile).every((l) => l.direction === 'backward'),
  );
  check(
    'the carriageways are physically offset',
    Math.abs(back.points[0][1] - fwd.points[0][1]) > 1e-6,
  );
  const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r));
  check('both carriageways share one identity', !!nw && nw.wayIds.includes(newId));
  check('a one-way way refuses to separate', store.getState().separateCarriageways(r) === null);

  const median = getComponent(store.getState().system.medians, nw!.id);
  check(
    'separateCarriageways captures a Median component keyed by the NamedWay',
    !!median && median.widthM > 0,
  );

  store.getState().setMedianWidth(nw!.id, 6);
  check(
    'setMedianWidth overrides the captured width',
    getComponent(store.getState().system.medians, nw!.id)?.widthM === 6,
  );

  store.getState().combineCarriageways(nw!.id);
  const combined = store.getState().system;
  check(
    'combineCarriageways restores a single way',
    combined.ways.length === 1 && combined.ways[0].id === r,
  );
  check('combined way is two-way again', !isOneWay(combined.ways[0].profile));
  check(
    'combined profile gained a median between carriageways',
    combined.ways[0].profile.lanes.some((l) => l.kindId === 'median'),
  );
  check(
    'combining restores the edited median width, not a generic default',
    combined.ways[0].profile.lanes.find((l) => l.kindId === 'median')?.widthM === 6,
  );
}

// --- combining carriageways carries the discarded half's anchors across ---
{
  // The realistic shape: a divided street imported from OSM as two one-way
  // carriageways under one name, with a cross street meeting one of them.
  // (Drawing a crossing instead would split the carriageway, which is its own
  // bug — see the identity-member checks below.)
  fresh();
  const divided: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [10, 11, 12],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: '-1', lanes: '2' },
      nodes: [20, 21, 22],
      geometry: [
        { lat: 36.1002, lon: -115.2 },
        { lat: 36.1002, lon: -115.15 },
        { lat: 36.1002, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential', name: 'Cross Street' },
      nodes: [21, 30],
      geometry: [
        { lat: 36.1002, lon: -115.15 },
        { lat: 36.11, lon: -115.15 },
      ],
    },
  ];
  store.getState().importWays(osmElementsToNetwork(divided));
  const sys = store.getState().system;
  const carriageways = sys.ways.filter((w) => w.source === 'osm:1' || w.source === 'osm:2');
  const cross = sys.ways.find((w) => w.source === 'osm:3')!;
  const nw = sys.namedWays.find((n) => n.name === 'Grand Boulevard')!;
  check('the divided street imports as one identity of two carriageways', nw.wayIds.length === 2);
  check(
    'both carriageways import one-way',
    carriageways.every((w) => isOneWay(w.profile)),
  );
  const nodesBefore = sys.nodes.length;
  check('the cross street shares a junction with one carriageway', nodesBefore === 1);

  const discarded = carriageways.find(
    (w) =>
      !isOneWay(w.profile) || directionalLanes(w.profile).every((l) => l.direction === 'backward'),
  )!;
  const stId = store.getState().addStation(discarded.points[0], { wayId: discarded.id, t: 0 });

  store.getState().combineCarriageways(nw.id);
  const after = store.getState().system;
  const survivor = after.ways.find((w) => w.id !== cross.id)!;
  check(
    'combining leaves one carriageway',
    after.ways.filter((w) => w.id !== cross.id).length === 1,
  );
  check(
    'combining keeps a station anchored to the discarded carriageway',
    after.stations.length === 1,
  );
  check(
    'and re-anchors it onto the surviving centerline',
    after.stations.find((st) => st.id === stId)?.anchor?.wayId === survivor.id,
  );
  check('combining keeps the junction the cross street made', after.nodes.length === nodesBefore);
  check(
    'and re-points its ref onto the surviving way',
    after.nodes.every((n) => n.refs.every((ref) => ref.wayId !== discarded.id)),
  );
  check(
    'so the cross street is still joined to the street',
    after.nodes.some((n) => n.refs.some((ref) => ref.wayId === cross.id)),
  );
  check('the survivor is two-way again', !isOneWay(survivor.profile));
}

// --- lane-keyed components don't outlive their lanes ---
{
  fresh();
  const w = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(w, [-115.2, 36.1]);
  store.getState().addWayPoint(w, [-115.1, 36.1]);
  store.getState().finishWay();
  const laneId = store
    .getState()
    .system.ways.find((x) => x.id === w)!
    .profile.lanes.find((l) => l.kindId === 'drive')!.id;
  store.getState().setTurnRestriction(w, laneId, []);
  check(
    'a turn restriction is stored against the lane',
    Object.keys(store.getState().system.turnRestrictions).length === 1,
  );

  // Deleting the way takes its lanes with it.
  store.getState().deleteWay(w);
  check(
    'deleting the way drops its turn restrictions',
    Object.keys(store.getState().system.turnRestrictions).length === 0,
  );

  // Replacing the cross-section mints fresh lane ids, so the old key is dead.
  fresh();
  const v = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(v, [-115.2, 36.1]);
  store.getState().addWayPoint(v, [-115.1, 36.1]);
  store.getState().finishWay();
  const vLane = store
    .getState()
    .system.ways.find((x) => x.id === v)!
    .profile.lanes.find((l) => l.kindId === 'drive')!.id;
  store.getState().setTurnRestriction(v, vLane, []);
  store.getState().applyProfilePreset(v, 'roadArterial4');
  check(
    'applying a preset drops restrictions on the lanes it replaced',
    !Object.keys(store.getState().system.turnRestrictions).includes(laneRefKey(v, vLane)),
  );

  // A live restriction is left alone.
  const liveLane = store
    .getState()
    .system.ways.find((x) => x.id === v)!
    .profile.lanes.find((l) => l.kindId === 'drive')!.id;
  store.getState().setTurnRestriction(v, liveLane, []);
  store.getState().setWayGrade(v, 'elevated');
  check(
    'an unrelated edit leaves a live restriction alone',
    Object.keys(store.getState().system.turnRestrictions).length === 1,
  );
}

// --- the carriageway affordances survive an ordinary edit ---
{
  fresh();
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.15, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(r, 'roadArterial4');
  const other = store.getState().separateCarriageways(r)!;
  const nwId = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!.id;
  check(
    'separating captures a median',
    getComponent(store.getState().system.medians, nwId) !== undefined,
  );

  // Splitting one carriageway is an ordinary edit — a cross street does it
  // automatically. The identity grows past two members, which used to hide
  // both the Combine button and the median field for good.
  store.getState().splitWayAt(other, 1);
  check(
    'a split takes the identity past two members',
    store.getState().system.namedWays.find((n) => n.id === nwId)!.wayIds.length > 2,
  );
  check(
    'but the captured median is still there to edit',
    getComponent(store.getState().system.medians, nwId) !== undefined,
  );
  store.getState().setMedianWidth(nwId, 7);
  check(
    'and it is still editable',
    getComponent(store.getState().system.medians, nwId)?.widthM === 7,
  );

  // combineCarriageways refuses two two-way ways under one identity, so the
  // UI's disabled state and the action agree.
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  const b = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(b, [-115.2, 36.11]);
  store.getState().addWayPoint(b, [-115.1, 36.11]);
  store.getState().finishWay();
  store.getState().nameWay(a, 'Twin Street');
  store.getState().nameWay(b, 'Twin Street');
  const twin = store.getState().system.namedWays.find((n) => n.name === 'Twin Street')!;
  const waysBefore = store.getState().system.ways.length;
  store.getState().combineCarriageways(twin.id);
  check(
    'combining refuses two two-way ways sharing an identity',
    store.getState().system.ways.length === waysBefore,
  );
}

// --- store: auto-junctions where ways cross (the SimCity moment) ---
{
  fresh();
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();

  // finishWay auto-formed the junction already; an explicit re-run is a no-op.
  store.getState().formCrossingJunctions(ns);
  const after = store.getState().system;
  check('crossing forms exactly one junction node', after.nodes.length === 1);
  check('the junction has four arms (both ways split)', after.ways.length === 4);
  check('all four arms meet at the junction', after.nodes[0].refs.length === 4);
  check(
    'no unresolved crossings remain',
    after.ways.every((a2, i) =>
      after.ways.every((b2, j) => i >= j || wayCrossings(a2, b2).length === 0),
    ),
  );
  check(
    'services still ride their (now split) ways',
    after.services.every((sv) => sv.patterns.every((p) => p.wayIds.length === 2)),
  );

  // Grade separation: an ELEVATED way crossing a surface street is an
  // overpass, never an intersection.
  fresh();
  const surface = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(surface, [-115.2, 36.1]);
  store.getState().addWayPoint(surface, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftGrade('elevated');
  const freeway = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(freeway, [-115.15, 36.05]);
  store.getState().addWayPoint(freeway, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().setDraftGrade('atGrade');
  store.getState().formCrossingJunctions(freeway);
  check(
    'different grades never auto-join (overpass, not intersection)',
    store.getState().system.nodes.length === 0 && store.getState().system.ways.length === 2,
  );
}

// --- store: junction semantics (control, connectors) ---
{
  fresh();
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().formCrossingJunctions(ns);
  const node = store.getState().system.nodes[0];
  store.getState().setNodeControl(node.id, 'signal');
  check('setNodeControl stores the control', store.getState().system.nodes[0].control === 'signal');

  const sys = store.getState().system;
  const armA = sys.ways.find((w) => sys.nodes[0].refs.some((r2) => r2.wayId === w.id))!;
  const armB = sys.ways.find(
    (w) => w.id !== armA.id && sys.nodes[0].refs.some((r2) => r2.wayId === w.id),
  )!;
  const conn = [
    {
      from: { wayId: armA.id, laneId: armA.profile.lanes[1].id },
      to: { wayId: armB.id, laneId: armB.profile.lanes[1].id },
    },
  ];
  store.getState().setNodeConnectors(node.id, conn);
  check(
    'setNodeConnectors stores the lane graph',
    store.getState().system.nodes[0].connectors?.length === 1,
  );
  // Deleting a referenced lane prunes its connectors.
  store.getState().setWayProfile(armA.id, {
    lanes: armA.profile.lanes.filter((l) => l.id !== armA.profile.lanes[1].id),
  });
  check(
    'removing a lane prunes connectors that referenced it',
    !store.getState().system.nodes[0].connectors,
  );
  store.getState().setNodeConnectors(node.id, undefined);
  check(
    'setNodeConnectors(undefined) reverts to heuristic',
    store.getState().system.nodes[0].connectors === undefined,
  );
}

// --- store: deleting a way cleans identity + connectors ---
{
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  const b = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(b, [-115.15, 36.05]);
  store.getState().addWayPoint(b, [-115.15, 36.15]);
  store.getState().finishWay();
  store.getState().formCrossingJunctions(b);
  const arms = store.getState().system.ways;
  const nodeId = store.getState().system.nodes[0].id;
  store.getState().setNodeConnectors(nodeId, [
    {
      from: { wayId: arms[0].id, laneId: arms[0].profile.lanes[1].id },
      to: { wayId: arms[1].id, laneId: arms[1].profile.lanes[1].id },
    },
  ]);
  store.getState().nameWay(arms[0].id, 'Sahara Ave');
  store.getState().deleteWay(arms[0].id);
  const sys = store.getState().system;
  check(
    'deleting a way drops its identity membership',
    !sys.namedWays.some((n) => n.wayIds.includes(arms[0].id)),
  );
  check(
    'deleting a way drops connectors that referenced it',
    sys.nodes.every(
      (n) => !n.connectors?.some((c) => c.from.wayId === arms[0].id || c.to.wayId === arms[0].id),
    ),
  );
}

// --- R2: per-lane street geometry (geometry/streets.ts) ---
{
  const road: Way = {
    id: 'lg',
    typeId: 'road',
    points: [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ], // due east
    geometry: 'straight',
    grade: 'atGrade',
    profile: buildProfile(PROFILE_PRESETS.roadArterial5.lanes),
  };
  const g = wayLaneGeometry(road);
  check('wayLaneGeometry derives one path per lane', g.lanes.length === road.profile.lanes.length);
  check('wayLaneGeometry memoizes per way object', wayLaneGeometry(road) === g);
  check(
    'total width matches the profile',
    Math.abs(g.totalWidthM - profileWidthM(road.profile)) < 1e-9,
  );
  const offsets = g.lanes.map((l) => l.offsetM);
  check(
    'lane offsets ascend left-to-right',
    offsets.every((o, i) => i === 0 || o > offsets[i - 1]),
  );
  check(
    'lane offsets are centered on the way',
    Math.abs(offsets[0] + offsets[offsets.length - 1]) < 0.5,
  );
  // Heading east: leftmost lane (negative offset = left of travel) is NORTH.
  const leftLane = g.lanes[0];
  check(
    'leftmost lane sits left of travel (north when heading east)',
    leftLane.path[0][1] > road.points[0][1],
  );
  // 5-lane w/ center turn: 2 back | turn | 2 fwd → one center line between
  // backward drive and the bidirectional turn lane? No — center transitions
  // are backward→both→forward, so the double-yellow appears where directions
  // OPPOSE directly; here the turn pocket separates them, so we expect
  // laneLines between same-direction pairs and edge lines at the sidewalks.
  check(
    'dividers include edge lines where roadway meets sidewalk',
    g.dividers.filter((d) => d.kind === 'edgeLine').length === 2,
  );
  check(
    'dividers include dashed lane lines between same-direction lanes',
    g.dividers.some((d) => d.kind === 'laneLine'),
  );
  const plain = buildProfile(PROFILE_PRESETS.roadArterial4.lanes);
  const g4 = wayLaneGeometry({ ...road, id: 'lg4', profile: plain });
  check(
    'opposing directions get a center line (4-lane, no median)',
    g4.dividers.some((d) => d.kind === 'centerLine'),
  );
  const backArrows = g.arrows.filter((a) => a.direction === 'backward');
  check(
    "backward lanes' arrow paths are reversed to travel direction",
    backArrows.every((a) => a.path[0][0] > a.path[a.path.length - 1][0]),
  );
  check(
    'bidirectional lanes emit no arrows',
    g.arrows.every((a) => a.direction !== 'both'),
  );
}

// --- Vehicles in Infrastructure view: direction detection, lane selection,
// lane-aware pattern path (geometry/vehicleLane.ts) ---
{
  // Two ways end-to-start, end-to-start — the natural "keep going forward"
  // case: way B's stored points already run the direction of travel.
  const wayA: Way = {
    id: 'va',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: { lanes: [] },
  };
  const wayB: Way = {
    id: 'vb',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.19, 36.1],
      [-115.18, 36.1],
    ],
    profile: { lanes: [] },
  };
  const traversals = patternWayTraversals([wayA, wayB], { id: 'p1', wayIds: ['va', 'vb'] });
  check('first way in a pattern defaults to forward', traversals[0].forward === true);
  check('a way continuing in its own stored order is forward', traversals[1].forward === true);

  // way C's own points run the OPPOSITE direction of travel (start where
  // way A ends up, at the far end) — traversing it means walking it backward.
  const wayC: Way = {
    id: 'vc',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.18, 36.1],
      [-115.19, 36.1],
    ],
    profile: { lanes: [] },
  };
  const reversedTraversals = patternWayTraversals([wayA, wayC], { id: 'p2', wayIds: ['va', 'vc'] });
  check(
    'a way stored opposite the direction of travel is detected as backward',
    reversedTraversals[1].forward === false,
  );

  // A 4-lane road: sidewalk, 2 backward drive, 1 forward bus, 1 forward
  // drive, sidewalk — built directly as a profile so the test doesn't
  // depend on catalog defaults changing later.
  const road: Way = {
    id: 'vroad',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'sw1', kindId: 'sidewalk', widthM: 2, direction: 'both' },
        { id: 'd1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
        { id: 'd2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
        { id: 'b1', kindId: 'bus', widthM: 3.6, direction: 'forward' },
        { id: 'd3', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'sw2', kindId: 'sidewalk', widthM: 2, direction: 'both' },
      ],
    },
  };
  const busLane = selectVehicleLane(road, true, 'bus');
  check(
    'a bus prefers the dedicated bus lane over a general drive lane',
    busLane?.kindId === 'bus',
  );

  const brtLane = selectVehicleLane(road, true, 'brt');
  check("BRT also prefers the bus lane (shares bus's preference list)", brtLane?.kindId === 'bus');

  const carModeLane = selectVehicleLane(road, true, 'subway'); // subway has no preferredLaneKindIds
  check(
    'a mode with no lane preference falls back to whichever direction-matching lane is nearest centerline (here, the bus lane at offset 1.65m beats the drive lane at 5.1m)',
    carModeLane?.kindId === 'bus',
  );

  const backwardLane = selectVehicleLane(road, false, 'bus');
  check(
    'no bus lane going backward on this road — falls back to a backward drive lane',
    backwardLane?.kindId === 'drive',
  );
  check(
    'the backward fallback is the one closest to centerline, not the outer one',
    backwardLane?.laneId === 'd2',
  );

  const noProfileWay: Way = {
    id: 'vempty',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: { lanes: [] },
  };
  check(
    'a way with no profile at all returns no lane (caller falls back to centerline)',
    selectVehicleLane(noProfileWay, true, 'bus') === null,
  );

  const lpWayA: Way = {
    id: 'lp-a',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'a-d1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'a-d2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      ],
    },
  };
  const lpWayB: Way = {
    id: 'lp-b',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.19, 36.1],
      [-115.18, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'b-d1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'b-d2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      ],
    },
  };
  const lpPath = patternLanePath([lpWayA, lpWayB], { id: 'lp1', wayIds: ['lp-a', 'lp-b'] }, 'bus');
  check('patternLanePath produces a continuous path across both ways', lpPath.length >= 2);
  check(
    "patternLanePath's endpoints roughly track the ways' own endpoints (offset by lane width, not miles)",
    Math.abs(lpPath[0][1] - 36.1) < 0.001 && Math.abs(lpPath[lpPath.length - 1][1] - 36.1) < 0.001,
  );
}

// --- Vehicles in Infrastructure view: bearing + rotated-rectangle footprint ---
{
  const dueNorth: LngLat[] = [
    [-115.2, 36.1],
    [-115.2, 36.11],
  ];
  check(
    'bearingAtT reads ~0° (north) for a due-north path',
    Math.abs(bearingAtT(dueNorth, 0.5)) < 1 || Math.abs(bearingAtT(dueNorth, 0.5) - 360) < 1,
  );

  const dueEast: LngLat[] = [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ];
  check(
    'bearingAtT reads ~90° (east) for a due-east path',
    Math.abs(bearingAtT(dueEast, 0.5) - 90) < 1,
  );

  check(
    'bearingAtT on a too-short path returns 0 rather than throwing',
    bearingAtT([[-115.2, 36.1]], 0.5) === 0,
  );

  const center: LngLat = [-115.2, 36.1];
  const ring = rotatedRectPolygon(center, 0, 3, 10); // facing due north
  check(
    'rotatedRectPolygon returns a closed ring (5 points, first === last)',
    ring.length === 5 && ring[0][0] === ring[4][0] && ring[0][1] === ring[4][1],
  );

  const [dx, dy] = metersFromOrigin(center, ring[0]);
  check(
    'facing north, a corner sits ~half-length north/south and ~half-width east/west of center',
    Math.abs(Math.abs(dy) - 5) < 0.1 && Math.abs(Math.abs(dx) - 1.5) < 0.1,
  );

  check(
    'a light rail vehicle is longer than a bus (real mode differentiation from size alone)',
    vehicleFootprint('lightRail').lengthM > vehicleFootprint('bus').lengthM,
  );
  check(
    'an unknown mode falls back to the bus footprint',
    vehicleFootprint('nonexistent-mode').lengthM === vehicleFootprint('bus').lengthM,
  );
  check(
    'every catalog mode has a default vehicle footprint',
    MODE_ORDER.every((id) => MODES[id].defaultFootprintM.widthM > 0),
  );
}

check(
  'bus mode prefers a dedicated bus lane over a general drive lane',
  MODES.bus.preferredLaneKindIds?.[0] === 'bus',
);
check(
  'subway has no lane preference (its only way type has one lane kind, no ambiguity)',
  MODES.subway.preferredLaneKindIds === undefined,
);

// --- R2: lane-detail rendering emission (LOD + viewport scoping) ---
{
  fresh();
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

  const infraFar = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
  });
  check(
    'without laneDetail the fan renders and lanes stay empty',
    infraFar.lanes.features.length === 0 && infraFar.ways.features.length > 0,
  );

  const infraNear = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
    laneDetail: true,
  });
  const wayObj = store.getState().system.ways[0];
  check(
    'laneDetail emits one surface per surface lane',
    infraNear.lanes.features.length === wayObj.profile.lanes.length,
  );
  check(
    'laneDetail replaces the fan for that way',
    infraNear.ways.features.filter((f) => f.properties?.id === r && !f.properties?.haloOnly)
      .length === 0,
  );
  check('laneDetail emits markings', infraNear.laneMarkings.features.length > 0);
  check('laneDetail emits direction arrows', infraNear.laneArrows.features.length > 0);
  check(
    'lane features carry a metric z14 pixel width',
    infraNear.lanes.features.every(
      (f) => typeof f.properties?.w14 === 'number' && f.properties.w14 > 0,
    ),
  );

  const offscreen = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
    laneDetail: true,
    bounds: [
      [-114.5, 36.5],
      [-114.4, 36.6],
    ],
  });
  check(
    'viewport scoping: offscreen ways keep the cheap fan',
    offscreen.lanes.features.length === 0 && offscreen.ways.features.length > 0,
  );

  const net = buildFeatures(store.getState().system, null, [], {
    viewMode: 'network',
    ...filters,
    laneDetail: true,
  });
  check('network view never lane-renders', net.lanes.features.length === 0);

  store.getState().setWayGrade(r, 'underground');
  const tunnel = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
    laneDetail: true,
  });
  check(
    'underground ways keep the dashed fan (no asphalt in a tunnel)',
    tunnel.lanes.features.length === 0,
  );
}

// --- R2: draft preset shapes newly drawn ways ---
{
  fresh();
  store.getState().setDraftWayType('road');
  store.getState().setDraftPreset('roadBoulevard');
  const r = store.getState().beginWay();
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways[0];
  check(
    "armed draft preset shapes the new way's profile",
    way.profile.lanes.some((l) => l.kindId === 'median'),
  );
  check('armed draft preset sets the class too', way.classId === 'arterial');
  store.getState().setDraftWayType('heavyRail');
  check('changing way type clears the armed preset', store.getState().draftPresetId === null);
}

// --- R3: junction footprints, trims, connectors (geometry/junctions.ts) ---
{
  // A real 4-way crossing built through the store (auto-junction on finish).
  fresh();
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  const sys = store.getState().system;
  check(
    'finishing a crossing way auto-forms the junction (no manual call)',
    sys.nodes.length === 1 && sys.ways.length === 4,
  );

  const waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const g = junctionGeometry(sys.nodes[0], waysById)!;
  check('junctionGeometry finds all four arms', g.arms.length === 4);
  check(
    'every arm of a 4-way crossing trims back',
    g.arms.every((a) => a.trimM > 1),
  );
  // Perpendicular same-width arms: trim ≈ the other road's half-width.
  const half = g.arms[0].halfWidthM;
  check(
    "perpendicular trim ≈ the crossing road's half-width",
    g.arms.every((a) => Math.abs(a.trimM - half) < 1.5),
  );
  check('footprint polygon has two corners per arm', g.polygon.length === 8);

  const trims = collectWayTrims([g]);
  check("collectWayTrims records a trim for every arm's way", trims.size === 4);

  // Default lane connectivity: every approach can go somewhere; through
  // lanes map straight, edges turn.
  const conns = defaultConnectors(sys.nodes[0], waysById);
  check(
    'default connectors exist for every approach',
    g.arms.every((arm) => conns.some((c) => c.from.wayId === arm.wayId)),
  );
  check(
    'default connectors include left, straight, and right turns',
    (() => {
      const classes = new Set<string>();
      for (const c of conns) {
        const inArm = g.arms.find((a) => a.wayId === c.from.wayId)!;
        const outArm = g.arms.find((a) => a.wayId === c.to.wayId)!;
        const hx = -inArm.dir[0],
          hy = -inArm.dir[1];
        classes.add(
          classifyTurn(
            Math.atan2(
              hx * outArm.dir[1] - hy * outArm.dir[0],
              hx * outArm.dir[0] + hy * outArm.dir[1],
            ),
          ),
        );
      }
      return classes.has('left') && classes.has('straight') && classes.has('right');
    })(),
  );
  check(
    'no default u-turns',
    conns.every((c) => c.from.wayId !== c.to.wayId),
  );

  const curves = connectorCurves(sys.nodes[0], waysById, trims);
  check(
    'every connector renders a curve',
    curves.length === conns.length && curves.every((c) => c.path.length >= 2),
  );

  // Stored connectors override the defaults.
  const custom = [conns[0]];
  store.getState().setNodeConnectors(sys.nodes[0].id, custom);
  const sys2 = store.getState().system;
  check(
    'stored connectors override the heuristic',
    effectiveConnectors(sys2.nodes[0], new Map(sys2.ways.map((w) => [w.id, w]))).length === 1,
  );

  // Directional lane bookkeeping: an "end" arm's incoming lanes are its
  // forward lanes; a "start" arm's are its backward lanes.
  const anyWay = sys.ways[0];
  const fwd = anyWay.profile.lanes.filter(
    (l) => l.direction === 'forward' && LANE_KINDS[l.kindId].directional,
  ).length;
  const back = anyWay.profile.lanes.filter(
    (l) => l.direction === 'backward' && LANE_KINDS[l.kindId].directional,
  ).length;
  check(
    "incoming/outgoing lane counts match the profile's split",
    incomingLanes(anyWay, 'end').length === fwd && outgoingLanes(anyWay, 'end').length === back,
  );
}

// --- turn restrictions: target-way identity, never an angle bucket
// (geometry/junctions.ts + editor/store.ts) ---
{
  fresh();
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  let sys = store.getState().system;
  let waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const node = sys.nodes[0];
  const g = junctionGeometry(node, waysById)!;
  const inArm = g.arms[0];
  const inLane = incomingLanes(waysById.get(inArm.wayId)!, inArm.end)[0];

  const unrestricted = defaultConnectors(node, waysById).filter(
    (c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id,
  );
  check(
    'this lane has more than one candidate target before any restriction',
    unrestricted.length > 0,
  );
  const oneTarget = unrestricted[0].to.wayId;

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, [oneTarget]);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const restricted = defaultConnectors(node, waysById, sys.turnRestrictions).filter(
    (c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id,
  );
  check(
    'a target-way restriction narrows default connectors to just that target',
    restricted.length > 0 && restricted.every((c) => c.to.wayId === oneTarget),
  );

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, []);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const blockedDefaults = defaultConnectors(node, waysById, sys.turnRestrictions);
  check(
    'an empty allow-list produces no default connector for that lane at all (the modal-filter case)',
    !blockedDefaults.some((c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id),
  );

  // A restriction also holds against an explicit user-set connector added
  // before the restriction existed — it's never silently bypassed.
  store.getState().setNodeConnectors(node.id, unrestricted);
  sys = store.getState().system;
  waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const effectiveWithStoredOverride = effectiveConnectors(node, waysById, sys.turnRestrictions);
  check(
    'effectiveConnectors filters even explicit stored connectors by an active restriction',
    !effectiveWithStoredOverride.some(
      (c) => c.from.wayId === inArm.wayId && c.from.laneId === inLane.id,
    ),
  );

  store.getState().setTurnRestriction(inArm.wayId, inLane.id, undefined);
  sys = store.getState().system;
  check(
    'clearing a restriction (undefined) removes it from the component map',
    getComponent(sys.turnRestrictions, laneRefKey(inArm.wayId, inLane.id)) === undefined,
  );
}

// --- kind-aware straight-through pairing (geometry/junctions.ts) — a lane
// that changes position across a profile change (e.g. a bus lane moving
// from center-running to curbside) should still default-connect to the
// same-kind lane on the far side, not whatever shares its numeric index. ---
{
  const wA: Way = {
    id: 'wA',
    typeId: 'road',
    points: [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: {
      lanes: [
        { id: 'a-bus', kindId: 'bus', widthM: 3.6, direction: 'forward' },
        { id: 'a-drive', kindId: 'drive', widthM: 3.3, direction: 'forward' },
      ],
    },
  };
  const wB: Way = {
    id: 'wB',
    typeId: 'road',
    points: [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: {
      lanes: [
        { id: 'b-drive', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'b-bus', kindId: 'bus', widthM: 3.6, direction: 'forward' },
      ],
    },
  };
  const swapNode: Node = {
    id: 'nX',
    coord: [-115.15, 36.1],
    refs: [
      { wayId: 'wA', pointIndex: 1 },
      { wayId: 'wB', pointIndex: 0 },
    ],
  };
  const swapWaysById = new Map([
    ['wA', wA],
    ['wB', wB],
  ]);
  const swapConns = defaultConnectors(swapNode, swapWaysById);
  const busConn = swapConns.find((c) => c.from.wayId === 'wA' && c.from.laneId === 'a-bus');
  const driveConn = swapConns.find((c) => c.from.wayId === 'wA' && c.from.laneId === 'a-drive');
  check(
    'kind-aware pairing connects bus-to-bus despite differing array position',
    !!busConn && busConn.to.laneId === 'b-bus',
  );
  check(
    'kind-aware pairing connects drive-to-drive too',
    !!driveConn && driveConn.to.laneId === 'b-drive',
  );
}

// --- per-approach traffic control override (editor/store.ts) ---
{
  fresh();
  const ew2 = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew2, [-115.2, 36.1]);
  store.getState().addWayPoint(ew2, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns2 = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns2, [-115.15, 36.05]);
  store.getState().addWayPoint(ns2, [-115.15, 36.15]);
  store.getState().finishWay();
  const node2 = store.getState().system.nodes[0];
  store.getState().setNodeControl(node2.id, 'signal');
  const waysById4 = new Map(store.getState().system.ways.map((w) => [w.id, w]));
  const arm = junctionGeometry(node2, waysById4)!.arms[0];

  check(
    'an approach has no override by default',
    getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end)) ===
      undefined,
  );
  store.getState().setApproachControl(arm.wayId, arm.end, 'stop');
  check(
    'setApproachControl stores an explicit per-approach override',
    getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end))
      ?.control === 'stop',
  );
  check(
    'the whole-node control is untouched by a per-approach override',
    store.getState().system.nodes.find((n) => n.id === node2.id)?.control === 'signal',
  );
  store.getState().setApproachControl(arm.wayId, arm.end, 'uncontrolled');
  check(
    "an explicit 'uncontrolled' override is distinct from having no override at all",
    getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end))
      ?.control === 'uncontrolled',
  );
  store.getState().setApproachControl(arm.wayId, arm.end, undefined);
  check(
    'clearing the override (undefined) removes it, reverting to the junction default',
    getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end)) ===
      undefined,
  );
}

// --- R3: trims flow into stage-1 lane geometry; trimPath behaves ---
{
  const line: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]; // ~9km east
  const trimmed = trimPath(line, 100, 200);
  check(
    'trimPath crops both ends',
    trimmed.length === 2 && trimmed[0][0] > line[0][0] && trimmed[1][0] < line[1][0],
  );
  check('trimPath with zero trims returns the path unchanged', trimPath(line, 0, 0) === line);
  check(
    'trimPath consuming the whole path returns empty',
    trimPath(
      [
        [-115.2, 36.1],
        [-115.1999, 36.1],
      ],
      50,
      50,
    ).length === 0,
  );

  const road: Way = {
    id: 'tw',
    typeId: 'road',
    points: line,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road', 4),
  };
  const full = wayLaneGeometry(road);
  const cut = wayLaneGeometry(road, 15, 0);
  check('trimmed lane geometry is cached separately from untrimmed', full !== cut);
  check(
    'trimmed lanes start ~15m in',
    (() => {
      const dx =
        (cut.lanes[0].path[0][0] - full.lanes[0].path[0][0]) *
        111320 *
        Math.cos((36.1 * Math.PI) / 180);
      return dx > 13 && dx < 17;
    })(),
  );
}

// --- R3: two-arm straight-through joints stay seamless ---
{
  fresh();
  const a = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(a, [-115.2, 36.1]);
  store.getState().addWayPoint(a, [-115.15, 36.1]);
  store.getState().addWayPoint(a, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().splitWayAt(a, 1);
  const sys = store.getState().system;
  const waysById = new Map(sys.ways.map((w) => [w.id, w]));
  const g = junctionGeometry(sys.nodes[0], waysById)!;
  check('a straight-through split joint draws no junction polygon', g.polygon.length === 0);
  check(
    'a straight-through joint trims nothing',
    g.arms.every((arm) => arm.trimM < 0.01),
  );
}

// --- R3: lane-detail rendering emits junction footprints + connector guides ---
{
  fresh();
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  const fc = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
    laneDetail: true,
  });
  check('lane detail emits the junction footprint', fc.junctions.features.length === 1);
  // Connector guides are scoped to the SELECTED junction — otherwise a complex
  // interchange renders as a star-burst of every junction's lane connectors.
  check(
    'connector guides are hidden for unselected junctions',
    fc.connectors.features.length === 0,
  );
  const far = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
  });
  check('no junction polygons below lane-detail zoom', far.junctions.features.length === 0);
  const nodeId = store.getState().system.nodes[0].id;
  const sel = buildFeatures(store.getState().system, { kind: 'node', id: nodeId }, [], {
    viewMode: 'infrastructure',
    ...filters,
    laneDetail: true,
  });
  check(
    "a selected junction's footprint is flagged",
    sel.junctions.features.some((f) => f.properties?.selected === true),
  );
  check('a selected junction emits its connector guides', sel.connectors.features.length > 0);
}

// --- R4: street name labels + lane keyboard shortcuts ---
{
  fresh();
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().nameWay(r, 'Decatur Avenue');
  store.getState().separateCarriageways(r);
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  const infra = buildFeatures(store.getState().system, null, [], {
    viewMode: 'infrastructure',
    ...filters,
  });
  const labels = infra.wayLabels.features.filter((f) => f.properties?.name === 'Decatur Avenue');
  check('both carriageways label as the one named street', labels.length === 2);
  const net = buildFeatures(store.getState().system, null, [], { viewMode: 'network', ...filters });
  check('street labels are infrastructure-view detail', net.wayLabels.features.length === 0);

  const laneBindings = KEY_BINDINGS.filter((b) => b.group === 'Lanes');
  check('lane shortcuts exist ([ ] D O + 9 presets)', laneBindings.length === 4 + 9);
  check(
    'preset shortcut keys are 1–9',
    laneBindings.filter((b) => /^[1-9]$/.test(b.keys[0])).length === 9,
  );
}

// --- bare infrastructure toggle: draw roads WITHOUT auto-creating a line ---
{
  fresh();
  store.getState().setDraftWayType('road');
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay();
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  check(
    'service toggle off: drawing a road creates NO service',
    store.getState().system.services.length === 0,
  );
  check(
    'the bare road itself exists and is selected-style bare infra',
    store.getState().system.ways.length === 1,
  );

  // Picking a mode is an explicit "draw a line" — it re-enables services.
  store.getState().setDraftMode('bus');
  check(
    'choosing a mode re-enables service creation',
    store.getState().draftServiceEnabled === true,
  );
  const r2 = store.getState().beginWay();
  store.getState().addWayPoint(r2, [-115.2, 36.2]);
  store.getState().addWayPoint(r2, [-115.1, 36.2]);
  store.getState().finishWay();
  check(
    'after re-enabling, drawing creates the service again',
    store.getState().system.services.length === 1,
  );
}

// ===========================================================================
// Routing over existing infrastructure (model/routeGraph.ts + store actions)
// ===========================================================================

// Builds a small street grid: two east-west roads crossed by one north-south
// road → auto-junctions split everything into arms.
function buildGrid() {
  fresh();
  const draw = (pts: LngLat[]) => {
    const w = store.getState().beginWay('road', 'straight');
    for (const p of pts) store.getState().addWayPoint(w, p);
    store.getState().finishWay();
    return w;
  };
  store.getState().setDraftServiceEnabled(false); // bare streets
  draw([
    [-115.3, 36.2],
    [-115.1, 36.2],
  ]); // top EW
  draw([
    [-115.3, 36.1],
    [-115.1, 36.1],
  ]); // bottom EW
  draw([
    [-115.2, 36.05],
    [-115.2, 36.25],
  ]); // NS, crossing both
  store.getState().setDraftServiceEnabled(true);
}

// --- routeBetween: shortest path through junctions, mid-way anchors ---
{
  buildGrid();
  const sys = store.getState().system;
  check(
    'grid built bare (no services) with junction-split arms',
    sys.services.length === 0 && sys.ways.length === 7 && sys.nodes.length === 2,
  );

  const wayAtCoord = (c: LngLat) => {
    const s = snap(sys.ways, c, 50);
    return s ? sys.ways.find((w) => w.id === s.wayId)! : null;
  };
  const wTop = wayAtCoord([-115.28, 36.2])!;
  const wBottom = wayAtCoord([-115.12, 36.1])!;
  const from = anchorOnWay(wTop, [-115.28, 36.2])!;
  const to = anchorOnWay(wBottom, [-115.12, 36.1])!;
  const res = routeBetween(sys, from, to, { allowedTypeIds: new Set(['road']) });
  check('routeBetween finds a path across two junctions', !!res && res.spans.length === 3);
  check(
    'route length ≈ manhattan distance (~29km)',
    !!res && res.lengthM > 25000 && res.lengthM < 33000,
  );
  const path = routePath(sys, res!.spans);
  check(
    'routePath starts and ends at the anchors',
    haversineMeters(path[0], from.coord) < 5 &&
      haversineMeters(path[path.length - 1], to.coord) < 5,
  );
  check(
    'route path is continuous (no jumps between spans)',
    path.every((p, i) => i === 0 || haversineMeters(path[i - 1], p) < 15000),
  );

  const none = routeBetween(sys, from, to, { allowedTypeIds: new Set(['heavyRail']) });
  check('routeBetween respects mode compatibility (no rail path over roads)', none === null);
}

// --- createRoutedService: materializes splits, service rides existing ways ---
{
  buildGrid();
  const sys = store.getState().system;
  const s1 = snap(sys.ways, [-115.28, 36.2], 50)!;
  const s2 = snap(sys.ways, [-115.12, 36.1], 50)!;
  const from = anchorOnWay(
    sys.ways.find((w) => w.id === s1.wayId)!,
    s1.coord,
  )!;
  const to = anchorOnWay(
    sys.ways.find((w) => w.id === s2.wayId)!,
    s2.coord,
  )!;
  const res = routeBetween(sys, from, to, { allowedTypeIds: new Set(['road']) })!;
  const waysBefore = sys.ways.length;
  const svcId = store.getState().createRoutedService(res.spans, 'bus');
  const after = store.getState().system;
  check('createRoutedService creates the service', !!svcId && after.services.length === 1);
  const svc = after.services[0];
  check(
    'the routed service rides one pattern of existing ways',
    svc.patterns.length === 1 && svc.patterns[0].wayIds.length === res.spans.length,
  );
  check('mid-way anchors split their ways (two new arms)', after.ways.length === waysBefore + 2);
  check(
    'no new parallel geometry was drawn (every ridden way pre-existed or is a split arm)',
    svc.patterns[0].wayIds.every((wid) =>
      after.ways.some((w) => w.id === wid && w.typeId === 'road'),
    ),
  );
  const ridden = after.ways.filter((w) => svc.patterns[0].wayIds.includes(w.id));
  const total = ridden.reduce((m, w) => m + wayLengthMeters(w), 0);
  check('ridden ways cover the route length', Math.abs(total - res.lengthM) < 500);
}

// --- route draft state machine (the drawing gesture's backend) ---
{
  buildGrid();
  const sys = store.getState().system;
  const s1 = snap(sys.ways, [-115.28, 36.2], 50)!;
  const s2 = snap(sys.ways, [-115.12, 36.1], 50)!;
  const from = anchorOnWay(
    sys.ways.find((w) => w.id === s1.wayId)!,
    s1.coord,
  )!;
  const to = anchorOnWay(
    sys.ways.find((w) => w.id === s2.wayId)!,
    s2.coord,
  )!;
  store.getState().startRouteDraft(from);
  check('startRouteDraft opens an empty draft', store.getState().routeDraft?.spans.length === 0);
  check(
    'extendRouteDraft appends routed spans',
    store.getState().extendRouteDraft(to) === true &&
      store.getState().routeDraft!.spans.length === 3,
  );
  const svcId = store.getState().commitRouteDraft();
  check(
    'commitRouteDraft creates the service and clears the draft',
    !!svcId &&
      store.getState().routeDraft === null &&
      store.getState().system.services.length === 1,
  );

  store.getState().startRouteDraft(from);
  store.getState().cancelRouteDraft();
  check(
    'cancelRouteDraft clears without creating anything',
    store.getState().routeDraft === null && store.getState().system.services.length === 1,
  );
}

// --- routing along a SINGLE way (the first-gesture case that hit the
// degenerate same-segment path in the browser) ---
{
  fresh();
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.3, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftServiceEnabled(true);
  const way = store.getState().system.ways[0];

  const from = anchorOnWay(way, [-115.27, 36.1])!;
  const to = anchorOnWay(way, [-115.14, 36.1])!;
  const res = routeBetween(store.getState().system, from, to, {
    allowedTypeIds: new Set(['road']),
  });
  check(
    'same-way route resolves (same-segment direct span)',
    !!res && res.spans.length === 1 && res.spans[0].noInterior === true,
  );
  check(
    'same-way route length matches the click distance (~11.7km)',
    !!res && res.lengthM > 11000 && res.lengthM < 12500,
  );
  const path = routePath(store.getState().system, res!.spans);
  check(
    'same-way route path runs between the two clicks',
    path.length === 2 &&
      Math.abs(path[0][0] - -115.27) < 1e-6 &&
      Math.abs(path[1][0] - -115.14) < 1e-6,
  );

  store.getState().startRouteDraft(from);
  check('extend along the same way succeeds', store.getState().extendRouteDraft(to) === true);
  const svcId = store.getState().commitRouteDraft();
  const sys = store.getState().system;
  check('committing a same-way route creates the service', !!svcId && sys.services.length === 1);
  const ridden = sys.services[0].patterns[0].wayIds;
  check(
    'the road was split into three arms; the line rides the middle one',
    sys.ways.length === 3 && ridden.length === 1,
  );
  const mid = sys.ways.find((w) => w.id === ridden[0])!;
  check(
    'the ridden arm spans exactly the clicked stretch',
    Math.abs(mid.points[0][0] - -115.27) < 1e-6 &&
      Math.abs(mid.points[mid.points.length - 1][0] - -115.14) < 1e-6,
  );
}

// --- adoptExistingInfrastructure: sketched line re-binds onto the grid ---
{
  buildGrid();
  // Sketch a bus line roughly along the top road, offset ~200m north — the
  // Network-view sketch flow (service enabled) creating parallel geometry.
  const sketch = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(sketch, [-115.28, 36.202]);
  store.getState().addWayPoint(sketch, [-115.12, 36.202]);
  store.getState().finishWay();
  const before = store.getState().system;
  const svc = before.services[0];
  check('sketch created its own service + parallel geometry', !!svc && before.ways.length > 7);
  // A station riding the sketch, to prove it follows the adoption.
  const st1 = store
    .getState()
    .addStation([-115.25, 36.202], { wayId: svc.patterns[0].wayIds[0], t: 0.2 });

  const rebound = store.getState().adoptExistingInfrastructure(svc.id);
  const after = store.getState().system;
  const adopted = after.services.find((sv) => sv.id === svc.id)!;
  check('adoptExistingInfrastructure rebinds the pattern', rebound === 1);
  check(
    'the adopted pattern rides real grid ways (top road arms)',
    adopted.patterns[0].wayIds.length >= 1 &&
      adopted.patterns[0].wayIds.every((wid) => after.ways.some((w) => w.id === wid)),
  );
  check(
    'adopted ways lie on the grid, not the sketch offset',
    adopted.patterns[0].wayIds.every((wid) => {
      const w = after.ways.find((x) => x.id === wid)!;
      return w.points.every((p) => Math.abs(p[1] - 36.2) < 0.0005);
    }),
  );
  const sketchWayIds = new Set(svc.patterns[0].wayIds);
  check(
    'orphaned sketch geometry was removed',
    after.ways.every((w) => !sketchWayIds.has(w.id)),
  );
  const station = after.stations.find((s2) => s2.id === st1)!;
  check(
    'the station followed onto an adopted way',
    !!station.anchor && adopted.patterns[0].wayIds.includes(station.anchor.wayId),
  );
}

// --- detectShapeRuns: import-time corridor conflation's interior-stretch matcher ---
{
  const origin: LngLat = [-115.2, 36.1];
  const mkWay = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [] },
  });

  // A — parallel-then-diverging (the trunk-and-branch case): a shape that
  // hugs an existing way for 200m then turns away should conflate only the
  // shared stretch, leaving the diverging tail fresh.
  {
    const W = mkWay('W', [offsetMeters(origin, 0, 0), offsetMeters(origin, 400, 0)]);
    const path = [
      offsetMeters(origin, 0, 5),
      offsetMeters(origin, 200, 5),
      offsetMeters(origin, 200, 50),
    ];
    const runs = detectShapeRuns(path, [W]);
    check('parallel-then-diverging: exactly 2 runs', runs.length === 2);
    check(
      'parallel-then-diverging: first run is on the existing way',
      'onWayId' in runs[0] &&
        runs[0].onWayId === 'W' &&
        runs[0].fromIdx === 0 &&
        runs[0].toIdx === 1,
    );
    check(
      'parallel-then-diverging: second run is fresh (the diverging tail)',
      'fresh' in runs[1] && runs[1].fromIdx === 1 && runs[1].toIdx === 2,
    );
  }

  // B — brief coincidental crossing: a mostly-unrelated path that happens to
  // run parallel to an existing way for a sub-tolerance 15m jog right where
  // it crosses should NOT conflate — the whole path stays fresh.
  {
    const V = mkWay('V', [offsetMeters(origin, 300, -100), offsetMeters(origin, 300, 300)]);
    const path = [
      offsetMeters(origin, 0, 0), // approaches heading east — 90° off V's heading, rejected regardless of proximity
      offsetMeters(origin, 300, 0), // lands ~on V, but the segment INTO it was heading-rejected
      offsetMeters(origin, 300, 15), // a 15m jog running parallel to V (< MIN_RUN_M) — a coincidental blip
      offsetMeters(origin, 600, 300), // diverges away again — heading-rejected
    ];
    const runs = detectShapeRuns(path, [V]);
    check(
      'brief coincidental crossing: collapses to a single fresh run',
      runs.length === 1 && 'fresh' in runs[0] && runs[0].fromIdx === 0 && runs[0].toIdx === 3,
    );
  }

  // C — multi-way run: existing infrastructure that itself splits mid-corridor
  // (two ways sharing a coincident endpoint) sub-divides the matched run with
  // no special-casing, then a short fresh tail past the end.
  {
    const A = mkWay('A', [offsetMeters(origin, 0, 0), offsetMeters(origin, 200, 0)]);
    const B = mkWay('B', [offsetMeters(origin, 200, 0), offsetMeters(origin, 400, 0)]);
    const path = [
      offsetMeters(origin, 0, 3),
      offsetMeters(origin, 200, 3),
      offsetMeters(origin, 400, 3),
      offsetMeters(origin, 400, 40),
    ];
    const runs = detectShapeRuns(path, [A, B]);
    check('multi-way run: exactly 3 runs', runs.length === 3);
    check('multi-way run: first run on way A', 'onWayId' in runs[0] && runs[0].onWayId === 'A');
    check('multi-way run: second run on way B', 'onWayId' in runs[1] && runs[1].onWayId === 'B');
    check('multi-way run: third run is the fresh tail', 'fresh' in runs[2]);
  }
}

// --- reconcileImportedServices: a shorter shuttle conflates onto a longer
// trunk's already-imported way instead of keeping duplicate overlapping
// geometry (the store-level orchestrator over detectShapeRuns) ---
{
  fresh();
  const origin: LngLat = [-115.2, 36.1];
  store.getState().setDraftMode('bus');

  // Trunk: a long solo-way pattern, as a freshly-imported GTFS shape would be.
  const trunk = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(trunk, offsetMeters(origin, 0, 0));
  store.getState().addWayPoint(trunk, offsetMeters(origin, 400, 0));
  store.getState().finishWay();
  const trunkSvc = store
    .getState()
    .system.services.find((sv) => sv.patterns.some((p) => p.wayIds.includes(trunk)))!;

  // Shuttle: another solo-way pattern, a strict corridor subset of the trunk
  // (offset 3m, spanning only the middle 200m) — diverges at both ends by
  // simply not covering the trunk's outer stretches, the exact "shares a
  // trunk, doesn't share termini" shape this feature targets.
  const shuttle = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(shuttle, offsetMeters(origin, 100, 3));
  store.getState().addWayPoint(shuttle, offsetMeters(origin, 300, 3));
  store.getState().finishWay();
  const shuttleSvc = store
    .getState()
    .system.services.find((sv) => sv.patterns.some((p) => p.wayIds.includes(shuttle)))!;

  const before = store.getState().system;
  check(
    'trunk and shuttle each start on their own solo way',
    before.ways.length === 2 && before.services.length === 2,
  );

  const reconciled = store.getState().reconcileImportedServices([trunkSvc.id, shuttleSvc.id]);
  const after = store.getState().system;
  check('exactly one pattern (the shuttle) needed reconciling', reconciled === 1);

  // The trunk's original way gets SPLIT to carve out the shared middle
  // sub-range (splitWay correctly extends every rider's pattern — including
  // the trunk's own — to cover all the resulting pieces, so its route is
  // never silently shortened): assert continuity, not an unchanged wayIds
  // array. The original trunk wayId survives as (at least) the front piece,
  // and the trunk's full route still spans its original ~400m end to end.
  const trunkAfter = after.services.find((sv) => sv.id === trunkSvc.id)!;
  check(
    "the trunk's original way id survives as (part of) its route",
    trunkAfter.patterns[0].wayIds.includes(trunk),
  );
  check(
    "the trunk's route is still continuous end-to-end (splitting didn't drop any of it)",
    Math.abs(pathLengthMeters(patternPath(after.ways, trunkAfter.patterns[0])) - 400) < 1,
  );

  const shuttleAfter = after.services.find((sv) => sv.id === shuttleSvc.id)!;
  check(
    'the shuttle no longer rides its own original solo way',
    !shuttleAfter.patterns[0].wayIds.includes(shuttle),
  );
  check(
    "the shuttle's original solo way was removed, not left as a duplicate",
    !after.ways.some((w) => w.id === shuttle),
  );
  check(
    "the shuttle's new way(s) lie on the trunk's alignment (y≈0), not its own original 3m offset",
    shuttleAfter.patterns[0].wayIds.every((wid) =>
      after.ways
        .find((w) => w.id === wid)!
        .points.every((p) => Math.abs(metersFromOrigin(origin, p)[1]) < 1),
    ),
  );
  check(
    'no whole duplicate alignment was created — at most 2 net new ways from splitting the trunk',
    after.ways.length <= before.ways.length + 2,
  );
}

// --- facility tool: place-on-click semantics (complex is a variant, not a
// hidden default) ---
{
  fresh();
  check(
    'facility tool starts in PLACE mode, not complex mode',
    store.getState().draftFacilityComplexMode === false,
  );
  store.getState().setDraftFacilityComplexMode(true);
  check('complex mode is opt-in', store.getState().draftFacilityComplexMode === true);
  store.getState().setDraftFacilityType('depot');
  check(
    'picking a facility type leaves complex mode',
    store.getState().draftFacilityComplexMode === false,
  );
  // Area facilities can be placed as polygons directly.
  const fid = store.getState().addFacility('depot', squareFootprint([-115.15, 36.1], 15));
  const fac = store.getState().system.facilities.find((f) => f.id === fid)!;
  check(
    'an area facility placed by click gets a real polygon',
    Array.isArray(fac.geometry[0]) && (fac.geometry as LngLat[]).length === 4,
  );
}

// --- one-way affordances: draft toggle, endpoint branch, network chevrons ---
{
  // Direction toggle: newly drawn ways come out one-way, travel = draw direction.
  fresh();
  store.getState().setDraftServiceEnabled(false);
  store.getState().setDraftOneWay(true);
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.3, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  const way = store.getState().system.ways[0];
  check('draft one-way: drawn road is one-way', isOneWay(way.profile));
  check(
    'draft one-way: travel runs the draw direction (forward)',
    directionalLanes(way.profile).every((l) => l.direction === 'forward'),
  );
  store.getState().setDraftOneWay(false);

  // Right-click endpoint branch: continues the street as a one-way segment.
  store.getState().nameWay(r, 'Main Street');
  const branchId = store.getState().beginOneWayBranch(r, 'end')!;
  const sys = store.getState().system;
  const branch = sys.ways.find((w) => w.id === branchId)!;
  check(
    "branch starts AT the source way's endpoint",
    branch.points.length >= 1 && branch.points[0][0] === -115.1,
  );
  check(
    'branch is one-way with fresh lane ids',
    isOneWay(branch.profile) &&
      branch.profile.lanes.every((l) => !way.profile.lanes.some((o) => o.id === l.id)),
  );
  check(
    'branch inherits type and class',
    branch.typeId === way.typeId && branch.classId === way.classId,
  );
  check(
    'branch is joined to the source at a real junction',
    sys.nodes.some(
      (n) => n.refs.some((x) => x.wayId === branchId) && n.refs.some((x) => x.wayId === r),
    ),
  );
  check(
    'branch continues the street identity',
    sys.namedWays.some((n) => n.name === 'Main Street' && n.wayIds.includes(branchId)),
  );
  check(
    'branch becomes the active draw with one-way armed',
    store.getState().activeWayId === branchId && store.getState().draftOneWay === true,
  );
  store.getState().cancelRouteDraft();
  store.getState().finishWay();
  store.getState().setDraftOneWay(false);

  // Network view shows one-way chevrons on SERVED one-way ways.
  fresh();
  store.getState().setDraftOneWay(true);
  const ow = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ow, [-115.3, 36.1]);
  store.getState().addWayPoint(ow, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftOneWay(false);
  store.getState().addServiceToWay(ow);
  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  const net = buildFeatures(store.getState().system, null, [], { viewMode: 'network', ...filters });
  check(
    'network view emits chevrons for a served one-way way',
    net.laneArrows.features.length === 1,
  );
  // Flip it and the chevron path reverses.
  const wref = store.getState().system.ways.find((w) => w.id === ow)!;
  store.getState().setWayProfile(ow, flipProfile(wref.profile));
  const net2 = buildFeatures(store.getState().system, null, [], {
    viewMode: 'network',
    ...filters,
  });
  const c1 = net.laneArrows.features[0].geometry.coordinates[0][0];
  const c2 = net2.laneArrows.features[0].geometry.coordinates[0][0];
  check('flipping the way reverses the chevron direction', c1 !== c2);
  // Two-way ways show no chevrons.
  store.getState().setWayProfile(ow, makeTwoWay(store.getState().system.ways[0].profile));
  const net3 = buildFeatures(store.getState().system, null, [], {
    viewMode: 'network',
    ...filters,
  });
  check('two-way ways get no chevrons in network view', net3.laneArrows.features.length === 0);
}

// --- station DRAWING: a dragged footprint is a real station ---
{
  fresh();
  store.getState().setDraftServiceEnabled(false);
  const r = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(r, [-115.2, 36.1]);
  store.getState().addWayPoint(r, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftServiceEnabled(true);

  // A footprint straddling the road: station anchors onto it.
  const fp = squareFootprint([-115.15, 36.1], 25);
  const sid = store.getState().addDrawnStation(fp);
  const st1 = store.getState().system.stations.find((x) => x.id === sid)!;
  check('drawn station carries its footprint', st1.footprint === fp);
  check('drawn station anchors onto the way it straddles', st1.anchor?.wayId === r);
  check("drawn station's coord sits on the way", Math.abs(st1.coord[1] - 36.1) < 1e-6);
  // Read the selection once: two separate getState() calls can't be narrowed
  // together, and the second was reading through a possibly-null value.
  const drawnSelection = store.getState().selection;
  check(
    'drawn station is selected for immediate platform work',
    drawnSelection?.kind === 'station' && drawnSelection.id === sid,
  );

  // A footprint in empty desert: still a station, just free-standing.
  const fp2 = squareFootprint([-115.4, 36.3], 25);
  const sid2 = store.getState().addDrawnStation(fp2);
  const st2 = store.getState().system.stations.find((x) => x.id === sid2)!;
  check(
    'a footprint away from any way makes a free station',
    st2.anchor === undefined && st2.footprint === fp2,
  );
}

// --- station land + structures: the border IS the station; structures on
// its land belong to it and are real shapes ---
{
  fresh();
  // Define a station's land.
  const land = squareFootprint([-115.15, 36.1], 60);
  const sid = store.getState().addDrawnStation(land);
  store.getState().setStationName(sid, 'Bonneville Transit Center');

  // A building drawn ON the land: real polygon, auto-joins the station.
  const bldg = store.getState().addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
  let sys = store.getState().system;
  const bf = sys.facilities.find((f) => f.id === bldg)!;
  check('a building is a drawn shape, not a point', Array.isArray(bf.geometry[0]));
  const complex = sys.groups.find((g) => g.memberIds.includes(sid));
  check(
    "a structure on station land joins the station's complex",
    !!complex && complex.memberIds.includes(bldg),
  );
  check(
    'the complex is named after the station',
    complex!.name === 'Bonneville Transit Center complex',
  );

  // A second structure joins the SAME complex (no duplicates).
  const bay = store.getState().addFacility('busBay', squareFootprint([-115.1498, 36.0998], 8));
  sys = store.getState().system;
  check(
    'further structures join the same complex',
    sys.groups.length === 1 && sys.groups[0].memberIds.includes(bay),
  );

  // An entrance point on the land joins too; one far away stays independent.
  const door = store.getState().addFacility('entrance', [-115.1501, 36.1001]);
  const remote = store.getState().addFacility('entrance', [-115.4, 36.4]);
  sys = store.getState().system;
  check('a point access on the land joins the station', sys.groups[0].memberIds.includes(door));
  check(
    'a facility off the land stays independent',
    !sys.groups[0].memberIds.includes(remote) && sys.groups.length === 1,
  );

  // Catalog: building exists as an AREA type.
  check('Building is a real area facility type', FACILITY_TYPES.building?.geometryKind === 'area');
}

// --- paint-order invariants: the street surface is the GROUND ---
// Station/complex footprints must paint ABOVE lane asphalt and junction
// fills, or a footprint straddling a lane-rendered street is invisible
// (the "station boundaries only show while dragging corners" bug).
{
  const order = LAYER_SPECS.map((l) => l.id);
  const above = (upper: string, lower: string) =>
    order.indexOf(upper) > order.indexOf(lower) && order.indexOf(lower) >= 0;
  check(
    'footprint fill paints above lane surfaces',
    above('tm-footprints-fill', 'tm-lane-surfaces'),
  );
  check('footprint fill paints above junction fills', above('tm-footprints-fill', 'tm-junctions'));
  check('platform fill paints above lane surfaces', above('tm-platforms-fill', 'tm-lane-surfaces'));
  check('station markers paint above footprints', above('tm-stations', 'tm-footprints-fill'));
}

// --- dwell-time timetable math (vehicles.ts) — the vehicle animation walks
// this instead of a plain distance/speed triangle wave once a pattern has
// stops, so a vehicle actually pauses at each station instead of gliding
// through it. ---
{
  const totalMeters = 1100;
  // No stops: pure constant-velocity travel, same as the old triangle wave.
  const noStops = buildTimetable(totalMeters, []);
  check(
    'no-stop timetable is pure travel time',
    noStops.oneWayMs === (totalMeters / VEHICLE_SPEED_MPS) * 1000,
  );
  check(
    'no-stop position is linear in elapsed time',
    metersAtElapsed(totalMeters, noStops, 50000) === 550,
  );

  // One stop halfway (550m in), dwelling 20s.
  const halfwayMs = (550 / VEHICLE_SPEED_MPS) * 1000; // 50000ms to reach it
  const oneStop = buildTimetable(totalMeters, [{ distMeters: 550, dwellMs: 20000 }]);
  check(
    'timetable adds the dwell on top of travel time',
    oneStop.oneWayMs === (totalMeters / VEHICLE_SPEED_MPS) * 1000 + 20000,
  );
  check(
    'still approaching the stop reads as mid-travel',
    metersAtElapsed(totalMeters, oneStop, halfwayMs - 10000) === 440,
  );
  check(
    'mid-dwell holds position at the stop',
    metersAtElapsed(totalMeters, oneStop, halfwayMs + 10000) === 550,
  );
  check(
    'travel resumes after the dwell ends',
    metersAtElapsed(totalMeters, oneStop, halfwayMs + 20000 + 10000) === 660,
  );
  check(
    "the full one-way time reaches the path's end",
    metersAtElapsed(totalMeters, oneStop, oneStop.oneWayMs) === totalMeters,
  );
}

// --- vehicle catalogs: effectiveVehicleKind resolution ---
{
  const busService: Service = {
    id: 'evk-bus',
    name: 'Bus',
    modeId: 'bus',
    color: '#2ea44f',
    patterns: [],
  };
  const sysNoKinds: TransitSystem = { ...createEmptySystem(), vehicleKinds: [] };

  const unassigned = effectiveVehicleKind(sysNoKinds, busService);
  const busDefault = vehicleFootprint('bus');
  check(
    "an unassigned service resolves to its mode's plain default size",
    unassigned.widthM === busDefault.widthM && unassigned.lengthM === busDefault.lengthM,
  );
  check(
    "an unassigned service resolves to the app's default speed",
    unassigned.speedMps === VEHICLE_SPEED_MPS,
  );

  const sysWithKind: TransitSystem = {
    ...sysNoKinds,
    vehicleKinds: [
      {
        id: 'evk1',
        modeId: 'bus',
        label: 'Articulated',
        widthM: 2.6,
        lengthM: 18,
        topSpeedKmh: 72,
      },
    ],
  };
  const assigned = effectiveVehicleKind(sysWithKind, { ...busService, vehicleKindId: 'evk1' });
  check(
    "an assigned service uses its vehicle kind's own dimensions",
    assigned.widthM === 2.6 && assigned.lengthM === 18,
  );
  check(
    "an assigned service's top speed converts km/h to m/s",
    Math.abs(assigned.speedMps - 20) < 1e-9,
  );

  const kindNoSpeed: TransitSystem = {
    ...sysNoKinds,
    vehicleKinds: [{ id: 'evk2', modeId: 'bus', label: 'No speed set', widthM: 3, lengthM: 20 }],
  };
  const assignedNoSpeed = effectiveVehicleKind(kindNoSpeed, {
    ...busService,
    vehicleKindId: 'evk2',
  });
  check(
    "an assigned kind with no topSpeedKmh falls back to the app's default speed",
    assignedNoSpeed.speedMps === VEHICLE_SPEED_MPS,
  );

  const danglingRef = effectiveVehicleKind(sysNoKinds, {
    ...busService,
    vehicleKindId: 'does-not-exist',
  });
  check(
    'a vehicleKindId pointing at a deleted kind falls back to the mode default, not a crash',
    danglingRef.widthM === busDefault.widthM,
  );
}

{
  // dwellStopsForPattern: only stations anchored to the pattern's OWN ways
  // count, ordered by arc-length along the resolved path (not by way index
  // or station-array order).
  const path: LngLat[] = [
    [-115.24, 36.1],
    [-115.17, 36.1],
  ];
  const sys = createEmptySystem();
  sys.stations = [
    { id: 'near-end', coord: [-115.19, 36.1], anchor: { wayId: 'w1', t: 0.7 } },
    { id: 'near-start', coord: [-115.22, 36.1], anchor: { wayId: 'w1', t: 0.2 } },
    { id: 'custom-dwell', coord: [-115.2, 36.1], anchor: { wayId: 'w1', t: 0.5 }, dwellSeconds: 5 },
    { id: 'other-way', coord: [-115.2, 36.1005], anchor: { wayId: 'w2', t: 0.5 } },
    { id: 'unanchored', coord: [-115.2, 36.1] },
  ];
  const pathMeters = haversineMeters(path[0], path[1]);
  const pattern = { id: 'p1', wayIds: ['w1'] };
  const stops = dwellStopsForPattern(sys, pattern, path, pathMeters);
  check("only stations anchored to the pattern's ways become stops", stops.length === 3);
  check(
    'stops are ordered by distance along the path, not input order',
    stops[0].distMeters < stops[1].distMeters && stops[1].distMeters < stops[2].distMeters,
  );
  check(
    'an unset dwell falls back to the default',
    stops[0].dwellMs === 20000 && stops[2].dwellMs === 20000,
  );
  check("a station's own dwellSeconds overrides the default", stops[1].dwellMs === 5000);
}

// --- bearingDegrees / formatBearing ---
{
  check('due east is 90°', Math.abs(bearingDegrees([-115.2, 36.1], [-115.1, 36.1]) - 90) < 0.5);
  check('due north is 0°', bearingDegrees([-115.2, 36.1], [-115.2, 36.2]) < 0.5);
  check(
    'due south wraps to ~180°',
    Math.abs(bearingDegrees([-115.2, 36.2], [-115.2, 36.1]) - 180) < 0.5,
  );
  check('formatBearing labels the nearest compass point', formatBearing(91) === '91° E');
  check('formatBearing rounds degrees', formatBearing(44.6) === '45° NE');
}

// --- map/landmarks: static reference points ---
{
  check(
    'every landmark has a real name and a valid [lng,lat] coord',
    LANDMARKS.every(
      (l) =>
        l.name.length > 0 &&
        l.coord.length === 2 &&
        Math.abs(l.coord[0]) <= 180 &&
        Math.abs(l.coord[1]) <= 90,
    ),
  );
  const fc = landmarksFeatureCollection();
  check(
    'landmarksFeatureCollection carries one feature per landmark',
    fc.features.length === LANDMARKS.length,
  );
  check(
    "each feature's name property round-trips",
    fc.features.every((f, i) => f.properties.name === LANDMARKS[i].name),
  );
}

// --- servedWayIds: spatial-grid index stays correct across cell/segment boundaries ---
{
  // A long way (many points, spanning several of the index's ~300m grid
  // cells) — a station near its FAR end must still be found. A naive index
  // that only registered a segment in the cell of its first point would
  // miss this (the exact bug shape a per-way bounding box or a
  // single-cell-per-segment index could hide).
  const longWay: Way = {
    id: 'long',
    typeId: 'road',
    points: Array.from({ length: 40 }, (_, i) => [-115.2 + i * 0.002, 36.1] as LngLat),
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const farWay: Way = {
    id: 'far',
    typeId: 'road',
    points: [
      [-114.0, 37.0],
      [-114.0, 37.01],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const nearFarEnd: LngLat = [longWay.points[39][0], 36.1];
  const served = servedWayIds(nearFarEnd, [longWay, farWay], 50);
  check("a station near a long way's far end is still found", served.includes('long'));
  check('a way many degrees away is correctly excluded', !served.includes('far'));
  check(
    'a coordinate with nothing nearby returns no matches',
    servedWayIds([-110, 40], [longWay, farWay], 50).length === 0,
  );
}

// --- determinism: index answers don't depend on bucket iteration order ---
// Both of these read the segment grid by walking cell buckets, so their answers
// used to depend on the order segments happened to be inserted. That is
// observable today (servedWayIds' first entry colors the station in
// buildFeatures) and it becomes a hard blocker for maintaining the grid
// INCREMENTALLY, since updating one way in place necessarily reorders buckets.
// Passing the same ways in a different array order is the cheap stand-in for
// that reordering: a different array is a different grid, built in a different
// order, and the answer must not move.
{
  const detRoad = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  });
  // Two ways lying exactly on top of each other — reachable with conflated or
  // duplicated GTFS shapes, and precisely the case distance alone can't settle.
  const twinA = detRoad('a-twin', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const twinB = detRoad('b-twin', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const onLine: LngLat = [-115.15, 36.1];
  check(
    'snap resolves exactly-equidistant ways the same way whichever order they were indexed in',
    snap([twinA, twinB], onLine, 50)?.wayId === 'a-twin' &&
      snap([twinB, twinA], onLine, 50)?.wayId === 'a-twin',
  );
  check(
    'servedWayIds orders coincident ways the same whichever order they were indexed in',
    JSON.stringify(servedWayIds(onLine, [twinA, twinB], 50)) ===
      JSON.stringify(servedWayIds(onLine, [twinB, twinA], 50)),
  );

  // Named so that sorting by id alone would put the FAR way first — this only
  // passes if the ordering is genuinely by distance.
  const nearWay = detRoad('z-near', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const farWay = detRoad('a-far', [
    [-115.2, 36.1004],
    [-115.1, 36.1004],
  ]); // ~44m north
  const ranked = servedWayIds(onLine, [farWay, nearWay], 90);
  check(
    "servedWayIds lists the nearest way first, so it decides a station's color",
    ranked.length === 2 && ranked[0] === 'z-near',
  );
}

// --- snap: shares servedWayIds' spatial grid — same boundary-correctness
// requirement, since a naive per-way-bbox or single-cell index would miss a
// coordinate near a long way's far end. ---
{
  const longWay: Way = {
    id: 'long',
    typeId: 'road',
    points: Array.from({ length: 40 }, (_, i) => [-115.2 + i * 0.002, 36.1] as LngLat),
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const farWay: Way = {
    id: 'far',
    typeId: 'road',
    points: [
      [-114.0, 37.0],
      [-114.0, 37.01],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const nearFarEnd: LngLat = [longWay.points[39][0], 36.1];
  const hit = snap([longWay, farWay], nearFarEnd, 50);
  check('snap finds the long way from a coordinate near its far end', hit?.wayId === 'long');
  check("snap's t lands at the far end of the path, not the near end", (hit?.t ?? 0) > 0.9);
  check(
    'snap finds nothing for a coordinate with no way nearby',
    snap([longWay, farWay], [-110, 40], 50) === null,
  );
}

// --- exportScale: niceScaleMeters / formatScaleMeters ---
{
  check('rounds down to the nearest 1/2/5 step', niceScaleMeters(347) === 200);
  check('picks an exact nice number unchanged', niceScaleMeters(500) === 500);
  check('works across a magnitude boundary', niceScaleMeters(950) === 500);
  check('formatScaleMeters stays in meters under 1km', formatScaleMeters(500) === '500 m');
  check('formatScaleMeters switches to km at 1000', formatScaleMeters(2000) === '2 km');
}

// --- render/svg: station labels must not print through each other ---
{
  // A deliberately cramped system: many named stations packed close enough
  // that naive placement overlapped them (it used to print "North Las Vegas"
  // straight through "South Strip").
  fresh();
  const ids: string[] = [];
  for (let i = 0; i < 14; i++) {
    const way = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(way, [-115.2 + i * 0.004, 36.1]);
    store.getState().addWayPoint(way, [-115.2 + i * 0.004, 36.13]);
    store.getState().finishWay();
    ids.push(store.getState().addStation([-115.2 + i * 0.004, 36.11 + (i % 3) * 0.002]));
  }
  const crowded = store.getState().system;
  crowded.name = 'Crowded';
  ids.forEach((id, i) => {
    const st = crowded.stations.find((s) => s.id === id);
    if (st) st.name = `Really Quite Long Station Name ${i}`;
  });

  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
  };
  const vp = fitBounds(systemBounds(crowded)!, { width: 1200, height: 630, padding: 56 });
  const dense = systemSvg(crowded, view, projector(vp), {
    title: crowded.name,
    legend: [],
    width: 1200,
    height: 630,
  });

  // Reconstruct each drawn label's box from the markup and check no two of
  // them intersect. Boxes are approximated the same way the renderer does.
  interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  const boxes: Box[] = [];
  for (const m of dense.matchAll(
    /<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(middle|start|end)" font-family="[^"]*" font-size="(\d+)"[^>]*>([^<]+)<\/text>/g,
  )) {
    const x = Number(m[1]),
      y = Number(m[2]),
      anchor = m[3],
      size = Number(m[4]);
    const w = m[5].length * size * 0.58;
    const left = anchor === 'middle' ? x - w / 2 : anchor === 'start' ? x : x - w;
    boxes.push({ left, right: left + w, top: y - size, bottom: y + size * 0.25 });
  }
  const intersects = (a: Box, b: Box) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  let collisions = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (intersects(boxes[i], boxes[j])) collisions++;
  }
  check('a crowded map still draws some station labels', boxes.length > 0);
  check('no two drawn labels overlap', collisions === 0);
  // Dropping labels is the mechanism, so a crowded map is expected to show
  // fewer than it has stations — but not to give up entirely.
  check(
    'crowding drops labels rather than all or nothing',
    boxes.length < ids.length && boxes.length >= 2,
  );

  // With room to breathe, every name should still make it.
  fresh();
  const roomy = store.getState().system;
  const sparse: string[] = [];
  for (let i = 0; i < 4; i++) {
    const way = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(way, [-115.4 + i * 0.3, 36.0]);
    store.getState().addWayPoint(way, [-115.4 + i * 0.3, 36.4]);
    store.getState().finishWay();
    sparse.push(store.getState().addStation([-115.4 + i * 0.3, 36.2]));
  }
  const spaced = store.getState().system;
  sparse.forEach((id, i) => {
    const st = spaced.stations.find((s) => s.id === id);
    if (st) st.name = `Stop ${i}`;
  });
  const vp2 = fitBounds(systemBounds(spaced)!, { width: 1200, height: 630, padding: 56 });
  const roomySvg = systemSvg(spaced, view, projector(vp2), {
    title: '',
    legend: [],
    width: 1200,
    height: 630,
  });
  check(
    'a sparse map keeps every station label',
    sparse.every((_, i) => roomySvg.includes(`Stop ${i}`)),
  );

  // The brand font stack is interpolated into font-family="..."; if the family
  // name is double-quoted it closes the attribute early and the whole document
  // is malformed. Apostrophes are what keep it embeddable.
  check('no attribute is broken by a quoted font name', !/font-family=""/.test(roomySvg));
  check(
    'every text element is well formed',
    (roomySvg.match(/<text /g) ?? []).length === (roomySvg.match(/<\/text>/g) ?? []).length,
  );
  void roomy;
}

// --- render/pngBytes: what an uploaded preview card has to survive ---
{
  // Share cards are rasterized by the sharer's browser and uploaded, because
  // a free-plan Worker hasn't the CPU to draw one. These bytes are therefore
  // untrusted input, and this is the gate they pass through.
  const CARD = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };

  // A minimal but structurally complete PNG: signature, IHDR, IEND. `trailing`
  // appends bytes after IEND, which is exactly the shape of a polyglot.
  const png = (w: number, h: number, trailing = 0): Uint8Array => {
    const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const bytes = new Uint8Array(8 + 25 + 12 + trailing);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set(u32(13), 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    bytes.set(u32(w), 16);
    bytes.set(u32(h), 20);
    // 5 more IHDR bytes (bit depth, colour type, ...) + 4 CRC, left zeroed.
    bytes.set(u32(0), 33); // IEND length
    bytes.set([0x49, 0x45, 0x4e, 0x44], 37); // "IEND"
    return bytes;
  };

  check(
    'reads dimensions out of a PNG header',
    JSON.stringify(pngDimensions(png(1200, 630))) === JSON.stringify(CARD),
  );
  check('a correctly sized card is accepted', checkPreviewPng(png(1200, 630), CARD).ok);

  // Each of these is a way the endpoint could otherwise become general-purpose
  // file storage on our own domain.
  check('empty bytes are rejected', !checkPreviewPng(new Uint8Array(0), CARD).ok);
  check(
    'a non-PNG is rejected',
    !checkPreviewPng(
      new Uint8Array([
        0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0,
      ]),
      CARD,
    ).ok,
  );
  check('a truncated file is rejected', !checkPreviewPng(png(1200, 630).subarray(0, 20), CARD).ok);
  check('a wrongly sized image is rejected', !checkPreviewPng(png(64, 64, 0), CARD).ok);
  check(
    'an oversized file is rejected',
    !checkPreviewPng(png(1200, 630, MAX_PREVIEW_BYTES), CARD).ok,
  );

  // A polyglot: a structurally valid PNG with a payload appended after IEND.
  // Response headers already make it inert, but it shouldn't be stored at all.
  const polyglot = png(1200, 630, 32);
  polyglot.set([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e], 8 + 25 + 12); // "<script>"
  check('a PNG with data appended after IEND is rejected', !checkPreviewPng(polyglot, CARD).ok);
  check(
    'a PNG with no IEND is rejected',
    !checkPreviewPng(png(1200, 630).subarray(0, 33), CARD).ok,
  );

  // A PNG signature with a different chunk where IHDR belongs is malformed,
  // and is the shape a polyglot file would take.
  const notIhdr = png(1200, 630);
  notIhdr.set([0x74, 0x45, 0x58, 0x74], 12); // "tEXt"
  check('a PNG signature with no IHDR is rejected', !checkPreviewPng(notIhdr, CARD).ok);

  // Rejection reasons are returned to the uploader, so they must describe the
  // upload rather than anything about the server.
  const reason = checkPreviewPng(new Uint8Array(1), CARD).reason ?? '';
  check(
    'a rejection explains itself without leaking internals',
    reason.length > 0 && !/\/|internal|stack/i.test(reason),
  );
}

// --- render/preview: the card the Worker rasterizes for link unfurls ---
{
  fresh();
  const line = store.getState().beginWay('lightRail', 'straight');
  store.getState().addWayPoint(line, [-115.22, 36.06]);
  store.getState().addWayPoint(line, [-115.14, 36.16]);
  store.getState().addWayPoint(line, [-115.12, 36.24]);
  store.getState().finishWay();
  const stationId = store.getState().addStation([-115.14, 36.16]);

  const system = store.getState().system;
  system.name = 'Valley Rapid Transit';
  const station = system.stations.find((s) => s.id === stationId);
  if (station) station.name = 'Downtown';
  for (const svc of system.services) svc.name = 'Resort Corridor';

  const svg = previewSvg(system);
  // Composed at half the raster size so the 2x scale-up doubles every font
  // size and line weight relative to the finished card.
  check(
    'preview is composed at half Open Graph card size',
    svg.startsWith(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH / 2}" height="${PREVIEW_HEIGHT / 2}"`,
    ),
  );
  check("preview draws the system's lines", svg.includes('<path'));
  check('preview draws stations', svg.includes('<circle'));

  // A social card is the network and nothing else. Two presentation facts
  // produce that, and neither one names an element to remove: the surface
  // captions itself (so the title and legend would just repeat the text Slack
  // already shows), and at ~460px the smaller type falls under the legibility
  // floor. There is no "card mode" anywhere in the renderer.
  check('a social card carries no text at all', !/<text/.test(svg));
  check("a social card doesn't repeat the system name", !svg.includes('Valley Rapid Transit'));
  check("a social card doesn't repeat the line names", !svg.includes('Resort Corridor'));
  check('a social card drops illegible station labels', !svg.includes('Downtown'));
  check(
    'a social card drops the scale bar and north arrow',
    !/\d+ (km|m)<\/text>/.test(svg) && !svg.includes('>N</text>'),
  );

  // Same composition, same code path, told it will be seen large and that
  // nothing else is captioning it: the detail comes back. This is what makes
  // it one renderer rather than two.
  const bigSvg = previewSvg(system, { displayWidth: 1200, captionedExternally: false });
  check('a large uncaptioned preview keeps station labels', bigSvg.includes('Downtown'));
  check('a large uncaptioned preview keeps its title', bigSvg.includes('Valley Rapid Transit'));
  check('a large uncaptioned preview keeps its legend', bigSvg.includes('Resort Corridor'));
  check('a large uncaptioned preview keeps the scale bar', /\d+ (km|m)<\/text>/.test(bigSvg));
  check('a large uncaptioned preview keeps the north arrow', bigSvg.includes('>N</text>'));

  // Size and captioning are independent: a big drawing that something else is
  // captioning still skips the caption, but keeps the detail it can show.
  const bigCaptioned = previewSvg(system, { displayWidth: 1200 });
  check(
    'captioning is independent of size',
    !bigCaptioned.includes('Valley Rapid Transit') && bigCaptioned.includes('Downtown'),
  );
  // Geometry paths are the ones with fill="none"; the north arrow is a filled
  // path, so counting every <path> would compare furniture too.
  const geometryPaths = (s: string) => (s.match(/<path [^>]*fill="none"/g) ?? []).length;
  check(
    'both sizes draw exactly the same geometry',
    geometryPaths(bigSvg) === geometryPaths(svg) && geometryPaths(svg) > 0,
  );

  // A legend must never outgrow the drawing it captions. Twenty lines used to
  // produce a panel taller than the card, running off the top edge.
  const manyLines = Array.from({ length: 20 }, (_, i) => ({
    color: '#e8562a',
    label: `Line ${i + 1}`,
  }));
  const cardHeight = PREVIEW_HEIGHT / 2;
  const crowded = systemSvg(
    system,
    {
      viewMode: 'network',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    },
    projector(
      fitBounds(systemBounds(system)!, {
        width: PREVIEW_WIDTH / 2,
        height: cardHeight,
        padding: 28,
      }),
    ),
    {
      title: system.name,
      legend: manyLines,
      width: PREVIEW_WIDTH / 2,
      height: cardHeight,
    },
  );
  // Both the title and the legend draw a translucent backing panel; the
  // legend's is the lower one, so take the largest y.
  const panelTops = [
    ...crowded.matchAll(/<rect x="0" y="([\d.]+)" width="\d+" height="[\d.]+" fill="rgba/g),
  ].map((m) => Number(m[1]));
  const panelTop = Math.max(...panelTops);
  check(
    'a long legend stays inside the drawing',
    panelTop > 0 && panelTop >= cardHeight * (1 - 0.56),
  );
  check('a long legend says how many it left out', /\+\d+ more/.test(crowded));
  check('a short legend is never truncated', !/\+\d+ more/.test(svg));

  // The export path (share/svgExport.ts) calls systemSvg with no displayWidth
  // at all, which must keep meaning "assume it's viewed at the size it was
  // drawn" — full detail, exactly as before any of this existed.
  const exportBounds = systemBounds(system)!;
  const exportViewport = fitBounds(exportBounds, { width: 1200, height: 630, padding: 56 });
  const exportSvg = systemSvg(
    system,
    {
      viewMode: 'network',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    },
    projector(exportViewport),
    {
      title: system.name,
      legend: [{ color: '#e8562a', label: 'Resort Corridor' }],
      width: 1200,
      height: 630,
      scaleBar: { widthPx: 100, label: '5 km' },
    },
  );
  check(
    'an export keeps station labels when no display size is given',
    exportSvg.includes('Downtown'),
  );
  check(
    'an export keeps its scale bar and north arrow',
    exportSvg.includes('5 km') && exportSvg.includes('>N</text>'),
  );

  // resvg inside a Worker has no system fonts, so wherever a server-rendered
  // drawing does have text, the markup must name the one font that actually
  // gets bundled — "system-ui" would silently render every label as nothing.
  // Checked against the variant that has text, since a card has none.
  check(
    'a server-rendered drawing names the bundled font',
    bigSvg.includes(`font-family="${PREVIEW_FONT_FAMILY}"`),
  );
  check('a server-rendered drawing never asks for a system font', !bigSvg.includes('system-ui'));
  // Literals on purpose: these pin the brand decision, so drifting back to a
  // hand-picked near-white or the editor's own typeface fails loudly.
  // Source of truth is lasvegasfortransit.org/brand.
  check('the bundled font is the brand face', PREVIEW_FONT_FAMILY === 'Public Sans');
  check(
    'the card ground is the brand surface',
    svg.includes(`fill="${LVBT.light.surface}"`) && LVBT.light.surface === '#F7F4EC',
  );
  check(
    'the card rule is the brand outline',
    svg.includes(`stroke="${LVBT.light.outline}"`) && LVBT.light.outline === '#0F1115',
  );
  // The framed area is a raised surface on the base one — two brand tokens,
  // not one. Flattening them back together is a regression, not a tidy-up.
  check(
    'the framed panel uses the raised-surface token',
    svg.includes(`fill="${LVBT.light.surfaceContainer}"`) &&
      LVBT.light.surfaceContainer === '#EFE9DB',
  );
  // Compared as plain strings on purpose. The tokens are `const`-typed, so
  // tsc can see the two literals differ and flags the comparison as pointless
  // — but the point is to fail if someone later edits one token to equal the
  // other, which is a runtime question about the brand, not a type question.
  check(
    'the panel and the ground are different tokens',
    (LVBT.light.surfaceContainer as string) !== (LVBT.light.surface as string),
  );

  // Pure white and the editor's cool ink have no business in anything that
  // leaves the app carrying the org's name.
  check('no pure white leaks into a share card', !/#ffffff|#FFFFFF/.test(svg));
  check('no non-brand ink leaks into a share card', !/#191a17|#111827/i.test(svg));

  // A share's name is unauthenticated user text and this markup is assembled
  // by hand, so escaping is the only thing standing between a system name and
  // broken (or injected) SVG.
  // Checked where the name is actually drawn — a social card never draws it,
  // so testing escaping there would pass for the wrong reason.
  fresh();
  const hostile = store.getState().system;
  hostile.name = `</text><script>alert(1)</script>`;
  const hostileSvg = previewSvg(hostile, { captionedExternally: false, displayWidth: 1200 });
  check('the drawn title carries the hostile name at all', hostileSvg.includes('alert(1)'));
  check("a system name can't inject markup into a drawing", !hostileSvg.includes('<script>'));
  check('a hostile system name is escaped, not dropped', hostileSvg.includes('&lt;script&gt;'));

  // An empty system has no extent to frame; it must still produce a card
  // rather than dividing by zero on its own bounds.
  fresh();
  const empty = store.getState().system;
  empty.name = 'Nothing yet';
  check('an empty system still renders a card', previewSvg(empty).startsWith('<svg'));
  check(
    "an empty system's name survives where one is drawn",
    previewSvg(empty, { captionedExternally: false }).includes('Nothing yet'),
  );
}

// --- render/project: the map-free projection the Worker draws through ---
{
  const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

  const vp = { center: [-115.14, 36.17] as LngLat, zoom: 12, width: 1200, height: 630 };
  const project = projector(vp);

  const middle = project(vp.center);
  check(
    'the viewport center projects to the center pixel',
    near(middle.x, 600, 1e-9) && near(middle.y, 315, 1e-9),
  );

  const east = project([-115.0, 36.17]);
  check('longitude east of center moves right', east.x > middle.x);
  check("a pure longitude change doesn't move vertically", near(east.y, middle.y, 1e-9));

  const north = project([-115.14, 36.3]);
  check('latitude north of center moves UP the screen', north.y < middle.y);

  // Zooming in one level doubles the pixel distance between two fixed points —
  // this is what "zoom is a log2 scale factor" has to mean for the Worker's
  // framing to match MapLibre's.
  const dxAt12 = project([-115.0, 36.17]).x - middle.x;
  const dxAt13 =
    projector({ ...vp, zoom: 13 })([-115.0, 36.17]).x - projector({ ...vp, zoom: 13 })(vp.center).x;
  check('one zoom level doubles projected distance', near(dxAt13 / dxAt12, 2, 1e-9));

  // fitBounds is what frames a stored system with no map to ask.
  const bounds: [LngLat, LngLat] = [
    [-115.3, 36.0],
    [-115.0, 36.3],
  ];
  const fitted = fitBounds(bounds, { width: 1200, height: 630, padding: 40 });
  const fit = projector(fitted);
  const sw = fit(bounds[0]);
  const ne = fit(bounds[1]);
  check(
    'fitBounds keeps the whole extent inside the viewport',
    sw.x >= 0 && ne.x <= 1200 && ne.y >= 0 && sw.y <= 630,
  );
  check('fitBounds respects the padding on the tight axis', ne.y >= 39.9 && sw.y <= 590.1);
  check('fitBounds centers the extent horizontally', near((sw.x + ne.x) / 2, 600, 0.5));
  check('fitBounds centers the extent vertically', near((sw.y + ne.y) / 2, 315, 0.5));

  // A one-station system has zero extent, which would otherwise fit at
  // infinite zoom — maxZoom is the only thing standing between that and a
  // divide-by-zero framing bug.
  const degenerate = fitBounds(
    [
      [-115.14, 36.17],
      [-115.14, 36.17],
    ],
    { width: 1200, height: 630, padding: 40, maxZoom: 14 },
  );
  check('a zero-extent system falls back to maxZoom', degenerate.zoom === 14);
  check(
    'a zero-extent system centers on its single point',
    near(degenerate.center[0], -115.14, 1e-9),
  );

  // A system that's wide but flat must be constrained by width, not height.
  const wide = fitBounds(
    [
      [-116.0, 36.16],
      [-114.0, 36.18],
    ],
    { width: 1200, height: 630, padding: 40 },
  );
  const wideProject = projector(wide);
  const left = wideProject([-116.0, 36.16]);
  check('a wide flat system is framed by its width', left.x >= 39.9 && left.x <= 40.1);

  check(
    'metersPerPixel shrinks as zoom grows',
    metersPerPixel({ ...vp, zoom: 13 }) < metersPerPixel(vp),
  );
  // Zoom 0 at the equator is the textbook ~156.5 km per pixel on 256px tiles,
  // or ~78.3 km on the 512px tiles MapLibre uses.
  check(
    'metersPerPixel matches the known zoom-0 equator value',
    near(
      metersPerPixel({ center: [0, 0], zoom: 0, width: 1, height: 1 }),
      40075016.686 / 512,
      1e-6,
    ),
  );
}

// --- store: straightenWay ---
{
  fresh();
  const w = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(w, [-115.2, 36.1]);
  store.getState().addWayPoint(w, [-115.17, 36.13]); // a wobble off the straight line
  store.getState().addWayPoint(w, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().straightenWay(w);
  const straightened = store.getState().system.ways.find((way) => way.id === w)!;
  check('straighten drops the non-junction intermediate point', straightened.points.length === 2);
  check(
    'straighten keeps the original endpoints',
    straightened.points[0][0] === -115.2 && straightened.points[1][0] === -115.1,
  );

  // A junction at the wobble point must survive straightening — the other
  // way's coincident control point can't be silently orphaned.
  fresh();
  const wB = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(wB, [-115.2, 36.1]);
  store.getState().addWayPoint(wB, [-115.17, 36.13]);
  store.getState().addWayPoint(wB, [-115.1, 36.1]);
  store.getState().finishWay();
  const wC = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(wC, [-115.17, 36.13]);
  store.getState().addWayPoint(wC, [-115.17, 36.2]);
  store.getState().finishWay();
  store.getState().joinWayPointToWay(wC, 0, wB, [-115.17, 36.13]);
  store.getState().straightenWay(wB);
  const guarded = store.getState().system.ways.find((way) => way.id === wB)!;
  check("straighten keeps a point that's a real junction", guarded.points.length === 3);
  check(
    'the junction node is still intact after straightening',
    store
      .getState()
      .system.nodes.some(
        (n) => n.refs.some((r) => r.wayId === wB) && n.refs.some((r) => r.wayId === wC),
      ),
  );
}

// --- tokens: generation, hashing, base64url ---
{
  const a = generateToken();
  const b = generateToken();
  check('generateToken returns a different value each call', a !== b);
  check('generateToken is url-safe', /^[A-Za-z0-9_-]+$/.test(a));
  check('generateToken defaults to 32 bytes (43 base64url chars)', a.length === 43);
  check('generateToken honors a byte length', generateToken(16).length === 22);

  check('toBase64Url strips padding', toBase64Url(new Uint8Array([1, 2])) === 'AQI');
  check(
    'toBase64Url uses - and _ instead of + and /',
    toBase64Url(new Uint8Array([251, 255])) === '-_8',
  );

  // Known SHA-256 of "abc", the standard test vector.
  const abc = await hashToken('abc');
  check(
    'hashToken returns lowercase hex sha-256',
    abc === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  check('hashToken is stable for the same input', (await hashToken('abc')) === abc);
  check('hashToken differs for different input', (await hashToken('abd')) !== abc);

  // Same digest, base64url-encoded rather than hex.
  check(
    'sha256Base64Url encodes the raw digest, not the hex string',
    (await sha256Base64Url('abc')) === 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
  );
}

// --- cookies: serialize and parse ---
{
  check(
    'serializeCookie writes the attributes the session cookie needs',
    serializeCookie('tm_session', 'abc', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60,
    }) === 'tm_session=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
  );
  check(
    'serializeCookie omits Secure when not asked for',
    !serializeCookie('tm_session', 'abc', { httpOnly: true, secure: false }).includes('Secure'),
  );
  check(
    'serializeCookie with maxAge 0 expires the cookie',
    serializeCookie('tm_session', '', { maxAge: 0, path: '/' }) ===
      'tm_session=; Path=/; Max-Age=0',
  );
  check(
    'serializeCookie encodes values that would break the header',
    serializeCookie('a', 'x;y').startsWith('a=x%3By'),
  );

  check('parseCookies handles a missing header', Object.keys(parseCookies(null)).length === 0);
  check('parseCookies reads one pair', parseCookies('tm_session=abc').tm_session === 'abc');
  check(
    'parseCookies reads several pairs regardless of spacing',
    parseCookies('a=1;b=2;  c=3').c === '3',
  );
  check('parseCookies decodes encoded values', parseCookies('a=x%3By').a === 'x;y');
  check(
    'parseCookies ignores malformed segments rather than throwing',
    Object.keys(parseCookies('garbage; a=1')).length === 1,
  );
}

// --- return-path validation and Google authorize URL ---
{
  check('safeReturnTo keeps a plain path', safeReturnTo('/s/abc123') === '/s/abc123');
  check(
    'safeReturnTo keeps a path with a query',
    safeReturnTo('/?view=network') === '/?view=network',
  );
  check('safeReturnTo falls back to / for null', safeReturnTo(null) === '/');
  check('safeReturnTo falls back to / for empty', safeReturnTo('') === '/');
  check('safeReturnTo rejects an absolute http url', safeReturnTo('https://evil.example') === '/');
  check('safeReturnTo rejects a protocol-relative url', safeReturnTo('//evil.example') === '/');
  check(
    'safeReturnTo rejects a backslash protocol-relative url',
    safeReturnTo('/\\evil.example') === '/',
  );
  check('safeReturnTo rejects anything not starting with /', safeReturnTo('s/abc') === '/');
  check('safeReturnTo rejects a javascript url', safeReturnTo('javascript:alert(1)') === '/');
  check('safeReturnTo rejects embedded control characters', safeReturnTo('/a\nb') === '/');

  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://example.test/auth/google/callback',
      state: 'st',
      codeChallenge: 'cc',
    }),
  );
  check('buildAuthorizeUrl targets Google', url.host === 'accounts.google.com');
  check('buildAuthorizeUrl asks for a code', url.searchParams.get('response_type') === 'code');
  check('buildAuthorizeUrl passes the client id', url.searchParams.get('client_id') === 'cid');
  check(
    'buildAuthorizeUrl passes the redirect uri',
    url.searchParams.get('redirect_uri') === 'https://example.test/auth/google/callback',
  );
  check('buildAuthorizeUrl passes the state', url.searchParams.get('state') === 'st');
  check(
    'buildAuthorizeUrl passes the code challenge',
    url.searchParams.get('code_challenge') === 'cc',
  );
  check(
    'buildAuthorizeUrl uses the S256 challenge method, never plain',
    url.searchParams.get('code_challenge_method') === 'S256',
  );
  check(
    'buildAuthorizeUrl requests only identity scopes',
    url.searchParams.get('scope') === 'openid email profile',
  );
}

// --- share ownership and claim reducer ---
{
  const now = 1_700_000_000_000;

  const owned = newShareOwnership('user_1', now);
  check('an owned share has an owner', owned.ownerId === 'user_1');
  check('an owned share never expires', owned.expiresAt === null);

  const anon = newShareOwnership(null, now);
  check('an anonymous share has no owner', anon.ownerId === null);
  check(
    'an anonymous share expires seven days out',
    anon.expiresAt === now + ANONYMOUS_SHARE_TTL_MS,
  );
  check('the anonymous ttl is seven days', ANONYMOUS_SHARE_TTL_MS === 7 * 24 * 60 * 60 * 1000);

  check('a 200 means the share was claimed', claimOutcome(200) === 'claimed');
  check('a 403 is permanent — the token is wrong or spent', claimOutcome(403) === 'rejected');
  check('a 409 is permanent — somebody already owns it', claimOutcome(409) === 'rejected');
  check('a 404 is permanent — the share expired and is gone', claimOutcome(404) === 'rejected');
  check('a 500 is worth retrying later', claimOutcome(500) === 'retry');
  check('a 429 is worth retrying later', claimOutcome(429) === 'retry');

  const held = [
    { id: 'a', claimToken: 'ta' },
    { id: 'b', claimToken: 'tb' },
    { id: 'c', claimToken: 'tc' },
    { id: 'd', claimToken: 'td' },
  ];
  const kept = retainedShares(held, [
    { id: 'a', status: 200 },
    { id: 'b', status: 403 },
    { id: 'c', status: 500 },
  ]);
  check('a claimed share is dropped from local storage', !kept.some((s) => s.id === 'a'));
  check('a rejected share is dropped, since retrying never helps', !kept.some((s) => s.id === 'b'));
  check(
    'a share that failed transiently is kept for next time',
    kept.some((s) => s.id === 'c'),
  );
  check(
    'a share with no result at all is kept',
    kept.some((s) => s.id === 'd'),
  );
  check('retainedShares keeps exactly the two it should', kept.length === 2);
  check('retainedShares does not mutate its input', held.length === 4);
}

// --- hostile input: parseSystem must survive values a person never types ---
//
// Every check above round-trips a document the store itself produced, which is
// exactly why two denial-of-service bugs lived here undetected: a `capacity` of
// `1e999` (which `JSON.parse` turns into `Infinity`) drove an unbounded lane
// loop, and an out-of-range coordinate made the segment grids iterate ~10^8
// cells. Both hung the tab on first render — including the public embed, so a
// stranger's shared link could take down the reader's page.
//
// These documents are the shapes an attacker or a corrupted file produces, not
// the shapes the editor produces. If one of these ever hangs the suite rather
// than failing it, that is the bug reappearing.
{
  const base = {
    version: 5,
    id: 'h',
    name: 'h',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  };
  // Mirrors serialize.ts's wrapLng, so the expectation is derived rather than
  // copied from whatever the implementation happened to print.
  const wrapExpected = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
  const wayWith = (extra: Record<string, unknown>) => ({
    ...base,
    ways: [
      {
        id: 'w',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        ...extra,
      },
    ],
  });

  // Capacity: the value that was `Infinity` by the time it reached the loop.
  for (const [label, capacity] of [
    ['infinite', JSON.parse('{"v":1e999}').v as number],
    ['negative infinite', JSON.parse('{"v":-1e999}').v as number],
    ['a billion', 1e9],
    ['not a number', JSON.parse('{"v":null}').v as number],
  ] as const) {
    const parsed = parseSystem(wayWith({ capacity, classId: 'arterial' }));
    check(`a ${label} capacity parses without hanging`, parsed.ways.length === 1);
    check(
      `a ${label} capacity is clamped to at most MAX_PRIMARY_LANES`,
      wayCapacity(parsed.ways[0]) <= MAX_PRIMARY_LANES,
    );
    check(`a ${label} capacity still yields at least one lane`, wayCapacity(parsed.ways[0]) >= 1);
  }
  check(
    'a capacity at the ceiling is kept exactly',
    wayCapacity(parseSystem(wayWith({ capacity: MAX_PRIMARY_LANES })).ways[0]) ===
      MAX_PRIMARY_LANES,
  );
  check(
    'an ordinary capacity is untouched by the clamp',
    wayCapacity(parseSystem(wayWith({ capacity: 4 })).ways[0]) === 4,
  );

  // withLaneCount is the same loop reached from the keyboard rather than a file.
  check(
    'withLaneCount refuses to build more than MAX_PRIMARY_LANES',
    laneCapacity(withLaneCount(defaultProfileFor('road', 2), 'road', 1e9)) <= MAX_PRIMARY_LANES,
  );
  check(
    'withLaneCount survives an infinite count',
    laneCapacity(
      withLaneCount(defaultProfileFor('road', 2), 'road', JSON.parse('{"v":1e999}').v),
    ) <= MAX_PRIMARY_LANES,
  );

  // Coordinates. Longitude wraps rather than being dropped: MapLibre hands
  // back unwrapped values when the user pans into an adjacent world copy, and
  // dropping an interior point silently changes the shape of a way.
  for (const [label, lng, expected] of [
    ['just past the antimeridian', 181, -179],
    ['far past the antimeridian', 1e6, wrapExpected(1e6)],
    ['exactly at the antimeridian', 180, -180],
  ] as const) {
    const parsed = parseSystem(
      wayWith({
        points: [
          [lng, 36.1],
          [-115.1, 36.1],
        ],
      }),
    );
    check(`a longitude ${label} is kept, not dropped`, parsed.ways[0].points.length === 2);
    check(
      `a longitude ${label} is wrapped onto the globe`,
      Math.abs(parsed.ways[0].points[0][0] - expected) < 1e-9,
    );
  }
  // Latitude has no wrap-around meaning, so past a pole really is nonsense.
  check(
    'a latitude past the pole is dropped',
    parseSystem(
      wayWith({
        points: [
          [-115.2, 91],
          [-115.1, 36.1],
        ],
      }),
    ).ways[0].points.length === 1,
  );
  check(
    'an ordinary coordinate is untouched',
    parseSystem(
      wayWith({
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
      }),
    ).ways[0].points.length === 2,
  );

  // The actual denial-of-service guard. Indexing cost is the area of a
  // segment's bounding box in grid cells, which is driven by how far apart
  // its endpoints are and NOT by how much data there is — so range-checking
  // coordinates does not bound it. Before MAX_SEGMENT_CELLS, a ±5° way froze
  // for 4.2s and ±10° crashed on V8's Map size limit; the world-spanning case
  // asks for ~7.2 billion cells.
  //
  // Asserted on the size of the index rather than on how long building it
  // took. The symptom was elapsed time, but a stopwatch here measures the
  // machine too — this assertion in its original form swung between 366ms and
  // 3972ms across consecutive runs on identical code, purely from load, and
  // failed the suite at random. The cell counts are what actually went wrong,
  // and they are the same on every machine on every run.
  for (const [label, lng, lat] of [
    ['spanning five degrees', 5, 2.5],
    ['spanning ten degrees', 10, 5],
    // Built as a Way directly rather than through parseSystem: the parser
    // wraps 180 to -180, which collapses the longitude span to nothing and
    // makes this case pass whether or not the bound exists.
    ['spanning the whole world', 180, 90],
  ] as const) {
    const wide = label.includes('whole world')
      ? [
          {
            ...parseSystem(
              wayWith({
                points: [
                  [-1, -1],
                  [1, 1],
                ],
              }),
            ).ways[0],
            points: [
              [-lng, -lat],
              [lng, lat],
            ] as [number, number][],
          },
        ]
      : parseSystem(
          wayWith({
            points: [
              [-lng, -lat],
              [lng, lat],
            ],
          }),
        ).ways;
    let threw = false;
    try {
      servedWayIds([0, 0], wide, 100);
    } catch {
      threw = true;
    }
    check(`a way ${label} indexes without throwing`, !threw);
    // Held aside, not expanded: one segment in, nothing in the grid. Without
    // MAX_SEGMENT_CELLS these are the millions-of-cells expansions that froze.
    const stats = segmentGridStats(wide);
    check(`a way ${label} is held aside rather than expanded`, stats.oversize === 1);
    check(`a way ${label} costs the grid nothing (${stats.entries} entries)`, stats.entries === 0);
  }

  // One wide segment is not the attack — many are. Capping a single
  // segment's expansion leaves N segments each just under the cap, which
  // multiply out to exactly the blowup the cap was added to stop. Measured
  // without the aggregate bound: 0.10 MB of such segments took 4.5 seconds
  // and 690 MB. This is the check that distinguishes the two bounds.
  {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10_001; i++) pts.push(i % 2 === 0 ? [0, 0] : [0.189, 0.189]);
    const many = parseSystem({
      ...base,
      ways: [{ id: 'w', typeId: 'road', points: pts, geometry: 'straight', grade: 'atGrade' }],
    });
    servedWayIds([0, 0], many.ways, 90);
    const stats = segmentGridStats(many.ways);
    // Each of the 10,000 segments is under MAX_SEGMENT_CELLS on its own, so
    // the per-segment cap lets every one of them through: this is ~41 million
    // entries with only that cap in place, and it is the aggregate bound and
    // nothing else that holds the number below.
    check(
      `ten thousand individually-legal wide segments stay under the grid bound (${stats.entries} entries)`,
      stats.entries <= MAX_GRID_CELLS,
    );
    // Overflow goes to the held-aside list, which every query scans in full —
    // so that list needs its own ceiling or the quadratic comes back there.
    check(
      `the overflow from those segments stays bounded (${stats.oversize} held aside)`,
      stats.oversize <= MAX_OVERSIZE_SEGMENTS,
    );
    // The bound must not have been reached by silently indexing nothing.
    check(
      'those segments are still indexed',
      stats.entries > 0 && servedWayIds([0, 0], many.ways, 90).includes('w'),
    );
  }

  // Held-aside segments must still be found, or the bound would be a silent
  // correctness regression rather than a fix.
  {
    const wide = parseSystem(
      wayWith({
        points: [
          [-50, 0],
          [50, 0],
        ],
      }),
    );
    check(
      'an oversize way is still reported as serving a point on it',
      servedWayIds([0, 0], wide.ways, 100).includes('w'),
    );
    check(
      'an oversize way is not reported for a point far off it',
      servedWayIds([0, 45], wide.ways, 100).length === 0,
    );
  }

  // Prototype keys in id-shaped positions: `X[id] ?? fallback` does not guard
  // against inherited members, so these used to resolve to Object.prototype's.
  for (const typeId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const parsed = parseSystem(wayWith({ typeId, capacity: 2 }));
    check(`a way typed "${typeId}" parses to a real way`, parsed.ways.length === 1);
    check(
      `a way typed "${typeId}" gets lanes with real widths`,
      parsed.ways[0].profile.lanes.every(
        (l) => typeof l.widthM === 'number' && Number.isFinite(l.widthM),
      ),
    );
  }
}

// --- local storage: the module where a bug means permanent data loss ---
//
// storage/localStore.ts had no coverage at all, which is the wrong file to
// leave untested: the editor's only copy of a person's work is the one it
// writes here. All of it is reachable from Node with a fake Storage, so the
// absence of a DOM was never the reason.
{
  interface FakeStorageOptions {
    /** Throw on the next write, the way a full quota does. */
    failWrites?: 'quota' | 'denied' | null;
  }
  class FakeStorage {
    map = new Map<string, string>();
    options: FakeStorageOptions = { failWrites: null };
    get length() {
      return this.map.size;
    }
    key(i: number) {
      return [...this.map.keys()][i] ?? null;
    }
    getItem(k: string) {
      return this.map.has(k) ? this.map.get(k)! : null;
    }
    removeItem(k: string) {
      this.map.delete(k);
    }
    clear() {
      this.map.clear();
    }
    setItem(k: string, v: string) {
      if (this.options.failWrites === 'quota') throw new DOMException('full', 'QuotaExceededError');
      if (this.options.failWrites === 'denied') throw new DOMException('nope', 'SecurityError');
      this.map.set(k, v);
    }
  }
  const storage = new FakeStorage();
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage = storage;
  const reset = () => {
    storage.map.clear();
    storage.options.failWrites = null;
  };

  const sys = (over: Partial<ReturnType<typeof createEmptySystem>> = {}) => ({
    ...createEmptySystem(),
    ...over,
  });

  // Outcomes are reported, not swallowed.
  reset();
  check('a successful save reports saved', saveToLibrary(sys({ id: 'a', name: 'A' })) === 'saved');
  storage.options.failWrites = 'quota';
  check('a save that hits the quota reports full', saveToLibrary(sys({ id: 'b' })) === 'full');
  storage.options.failWrites = 'denied';
  check(
    "a save into unavailable storage says so, rather than 'make room'",
    saveToLibrary(sys({ id: 'c' })) === 'unavailable',
  );
  storage.options.failWrites = null;

  // A saved system comes back; the three load states are distinguishable.
  reset();
  saveToLibrary(sys({ id: 'a', name: 'Alpha' }));
  check('a saved system loads back', loadSystemEntry('a').status === 'ok');
  check(
    'an id that was never saved reads as missing, not corrupt',
    loadSystemEntry('nope').status === 'missing',
  );
  storage.map.set('transitmapper:system:broken', '{ not json');
  check(
    "bytes that won't parse read as corrupt, not missing",
    loadSystemEntry('broken').status === 'corrupt',
  );
  check(
    'a corrupt record is not deleted by reading it',
    storage.getItem('transitmapper:system:broken') !== null,
  );

  // The legacy migration must not drop the old key until the copy is safe.
  reset();
  storage.map.set('transitmapper:system', JSON.stringify(sys({ id: 'legacy', name: 'Legacy' })));
  storage.options.failWrites = 'quota';
  const rescued = migrateLegacySingleSlot();
  check(
    "a legacy system is still returned when its rescue copy can't be written",
    rescued?.id === 'legacy',
  );
  check(
    'a failed rescue leaves the legacy key in place — it is the only copy',
    storage.getItem('transitmapper:system') !== null,
  );
  storage.options.failWrites = null;
  migrateLegacySingleSlot();
  check(
    'a successful rescue removes the legacy key',
    storage.getItem('transitmapper:system') === null,
  );
  check(
    'a successful rescue leaves the system in the library',
    listLibrary().some((e) => e.id === 'legacy'),
  );

  // A system written without its index entry is still reachable.
  reset();
  saveToLibrary(sys({ id: 'a', name: 'Alpha' }));
  storage.map.delete('transitmapper:library');
  check(
    'a system with no index entry is recovered into the library',
    listLibrary().some((e) => e.id === 'a'),
  );
  check(
    'a recovered system keeps its real name',
    listLibrary().find((e) => e.id === 'a')?.name === 'Alpha',
  );
  check('a recovered system is loadable', loadSystemEntry('a').status === 'ok');
  reset();
  storage.map.set('transitmapper:system:junk', '{ not json');
  check(
    'an unparseable orphan is still listed, so it can be deleted',
    listLibrary().some((e) => e.id === 'junk'),
  );
  check(
    'the library does not invent entries when storage is empty',
    (reset(), listLibrary().length === 0),
  );

  // Recovery must not fight deletion: the bytes go first, so a deleted system
  // has nothing left for the orphan scan to find and resurrect.
  reset();
  saveToLibrary(sys({ id: 'gone', name: 'Gone' }));
  check('deleting reports success', deleteFromLibrary('gone') === 'saved');
  check(
    'a deleted system does not come back as an orphan',
    !listLibrary().some((e) => e.id === 'gone'),
  );
  check(
    'a deleted system is really gone from storage',
    loadSystemEntry('gone').status === 'missing',
  );

  // A delete that can't write leaves the row alone rather than half-removing
  // it — otherwise the entry would vanish while the bytes stayed, and the
  // next listing would resurrect it, looking like a delete that undid itself.
  reset();
  saveToLibrary(sys({ id: 'stuck', name: 'Stuck' }));
  storage.options.failWrites = 'quota';
  check(
    "a delete that can't update the index reports the failure",
    deleteFromLibrary('stuck') !== 'saved',
  );
  storage.options.failWrites = null;
  check(
    'a failed delete leaves the system listed rather than half-removed',
    listLibrary().some((e) => e.id === 'stuck'),
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
