import { createStore } from 'zustand/vanilla';
import {
  INITIAL_DRAFT,
  LANE_KINDS,
  PROFILE_PRESETS,
  laneKind,
  mode,
  modesForWayType,
  wayType,
  type Grade,
} from '@transitmapper/core/model/catalog';
import {
  buildProfile,
  cloneProfile,
  combineProfiles,
  defaultProfileFor,
  directionalLanes,
  flipProfile,
  makeOneWay,
  profileWidthM,
  separateProfiles,
  withLaneCount,
} from '@transitmapper/core/model/profile';
import { modeRender } from '@transitmapper/core/style/catalogStyle';
import { liveCamera } from '../camera/liveCamera';
import {
  candidateWayIdsAlong,
  CONFLATION_TOLERANCE_M,
  densifyForMatching,
  detectShapeRuns,
  dropCollinearPoints,
  haversineMeters,
  metersFromOrigin,
  nearestInsertionPoint,
  nearestOnPath,
  offsetMeters,
  offsetPolyline,
  pathLengthMeters,
  patternPath,
  patternSegments,
  patternWayIds,
  pointAtT,
  pointInPolygon,
  resolveWayPath,
  snap,
  squareFootprint,
  wayById,
  wayLengthMeters,
  wholeLeg,
  type ShapeRun,
  patternLegs,
  oneSection,
  patternRunPath,
  patternRunLegs,
  patternHasSplit,
  anchorOnWayId,
  primaryAnchor,
} from '@transitmapper/core/model/geo';
import {
  anchorOnWay,
  routeBetween,
  type RouteAnchor,
  type RouteSpan,
} from '@transitmapper/core/model/routeGraph';
import { wayCrossings } from '@transitmapper/core/model/validate';
import {
  mergeLegs,
  removeStretchFromLegs,
  splitLegs,
  splitLegsAt,
  splitLegsIntoRuns,
  truncateLegs,
  mapSectionLegs,
  pruneSections,
  normalizeSections,
} from '@transitmapper/core/model/patternEdits';
import {
  closePatternTerminus,
  dividePatternAtPosition,
  endPatternAtPosition,
  extendPatternTerminus as extendPatternTerminusInCore,
  trimPatternAtPosition,
  type PatternPosition,
} from '@transitmapper/core/model/serviceEdits';
import type {
  TerminusGesturePlan,
  TerminusGestureSource,
  TerminusGestureTarget,
} from '@transitmapper/core/model/serviceGestures';
import { materializeRouteSpans } from '@transitmapper/core/model/routeLegs';
import type { SelectionRef } from '@transitmapper/core/model/selectionActions';
import {
  throughRouteServices,
  throughRouteServicesAt,
} from '@transitmapper/core/model/throughRoute';
import { shortId } from '@transitmapper/core/model/ids';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  armRefKey,
  getComponent,
  laneRefKey,
  prunedToLiveLanes,
  withComponent,
  withoutComponent,
} from '@transitmapper/core/model/components';
import {
  createFacility,
  createGroup as createGroupEntity,
  createStation,
} from '@transitmapper/core/model/system';
import { withoutAlreadyImported, type ImportedNetwork } from '@transitmapper/core/model/import';
import type {
  RunDirection,
  PatternSection,
  CrossSection,
  DrivingSide,
  Facility,
  Group,
  LaneConnector,
  LineGeometry,
  LngLat,
  NamedWay,
  Node,
  NodeControl,
  PatternLeg,
  Platform,
  SchedulePeriod,
  Service,
  Station,
  StationAnchor,
  TransitSystem,
  VehicleKind,
  Viewport,
  Way,
  WayPointRef,
} from '@transitmapper/core/model/system';

/** `lines` selects SERVICES and only services — a drag-select for routes,
 *  offered in the Network view where lines are what you are working on. The
 *  Select tool stays the one that picks up and moves infrastructure. */
export type Tool = 'select' | 'way' | 'station' | 'facility' | 'lines';

// A freshly-drawn line should already be a "working" one — an ambient
// vehicle animating along it — without a trip to the Inspector first (both
// service-creation sites below use these). Mirrors the Inspector's own
// "10 min" / "6am–11pm" default preset chips, so the value never surprises
// once the panel IS opened.
const DEFAULT_FREQUENCY_MINUTES = 10;
const DEFAULT_SPAN_START = '06:00';
const DEFAULT_SPAN_END = '23:00';

export type Selection =
  | { kind: 'way'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'node'; id: string }
  | null;

/** One member of a multi-select group — the "nudge this whole line" /
 *  "delete these five things together" set, kept separate from `Selection`
 *  (which stays one object, driving the Inspector) rather than trying to
 *  make one field do both jobs.
 *
 *  Declared in core as SelectionRef because the action registry takes a
 *  selection as its input and core cannot import from this app. A member may
 *  be a SERVICE as well as infrastructure — see deleteMultiSelection and
 *  nudgeSelection, which each had to decide what that means. */
export type MultiSelectItem = SelectionRef;

const FOOTPRINT_HALF_SIZE_M = 30;
// How far a drawn station footprint's center may sit from a way and still
// anchor onto it — generous, since a station box usually straddles its line.
const STATION_DRAW_ANCHOR_M = 60; // a ~60m default station footprint
const PLATFORM_HALF_SIZE_M = 12; // a ~24m default platform, sized to fit inside
const GROUP_FOOTPRINT_HALF_SIZE_M = 20; // a ~40m default facility-complex site

export interface SetSystemOptions {
  readOnly?: boolean;
}

export interface ApplyImportedReconciliation {
  /** Main-thread object identity captured before the Worker started. */
  expectedSystem: TransitSystem;
  result: ReconcileImportedSystemResult;
}

export interface GtfsImportPieces {
  ways: Way[];
  services: Service[];
  stations: Station[];
}

export interface ApplyGtfsImportBatch {
  /** Document that owned the import when the background operation began. */
  targetSystemId: string;
  pieces: GtfsImportPieces;
}

/**
 * What a Select press does.
 *
 * Erasing and splitting are things the Select tool DOES, not settings it
 * carries, so they are variants of it the way a road's cross-section is a
 * variant of the Road tool — one choice, shown on the dock button, picked from
 * its chevron. A press cannot both erase and split, and three independent
 * toggles said otherwise.
 *
 * This is also how the two operations are reachable without a keyboard. Alt
 * and Ctrl still work and are ORed with the variant, so nothing changes for a
 * mouse; a finger picks the same thing from the dock.
 *
 * Shift is deliberately absent. It constrains a drag already under way rather
 * than deciding what a press does, so it is not a variant of anything — and by
 * finger you can simply draw the angle you meant.
 */
export type SelectVariant = 'select' | 'erase' | 'split';

export interface EditorState {
  system: TransitSystem;
  tool: Tool;
  /** See SelectVariant. Not undoable: it decides what the next press does
   *  rather than describing the system. */
  selectVariant: SelectVariant;
  selection: Selection;
  /** Transient branch focus for service-owned map affordances. */
  activePatternId: string | null;
  /** A service terminus chosen for a follow-up gesture. This is deliberately
   * ephemeral: Task 4 consumes or clears it before any route changes. */
  armedTerminus: {
    serviceId: string;
    patternId: string;
    side: 'start' | 'end';
    position: PatternPosition;
  } | null;
  /** Bumped by selectAndFocus (never by plain select) — MapCanvas watches
   *  this, not `selection` itself, to know when to pan/fit the camera onto
   *  the newly selected thing. A direct map click already shows the user
   *  where it is; re-centering there would just be disorienting. Chrome-
   *  driven selection (the Objects list, keyboard nav, Inspector "jump to
   *  member" links, Issues) has no such context, so it asks for a focus. */
  cameraFocusToken: number;
  /** Bumped by addStation only — StationInspector watches this (alongside
   *  focusNameStationId, which the token pairs with) to know when to focus
   *  + select-all the name field: placing a station is the one moment a
   *  person's very next intent is almost always "name it right now," unlike
   *  simply re-selecting an existing one later. StationInspector calls
   *  consumeFocusName right after acting on it — this still needs that
   *  explicit clear (unlike cameraFocusToken, which nothing ever "consumes"
   *  the same way): switching from some OTHER selected object back to this
   *  same station later remounts StationInspector without the token itself
   *  changing, and an un-cleared focusNameStationId would still match. */
  focusNameToken: number;
  focusNameStationId: string | null;
  /** Shift-click builds this up alongside (and clears) `selection` — a set of
   *  ways/stations/facilities to move or delete together. See MultiSelectItem. */
  multiSelection: MultiSelectItem[];
  /** Way currently being drawn, or null. */
  activeWayId: string | null;
  /** Whether the line being drawn was started with Alt held: lay independent
   *  infrastructure rather than sharing whatever it runs along. Read by
   *  finishWay, so it has to outlive the press that set it — the express track
   *  beside the local one is still a separate track three clicks later. */
  draftSeparate: boolean;
  draftWayTypeId: string;
  draftModeId: string;
  draftGeometry: LineGeometry;
  /** Color a newly drawn service takes. */
  draftColor: string;
  /** Grade a newly drawn way takes. */
  draftGrade: Grade;
  /** Facility class a newly drawn way takes, if its type has classes. */
  draftClassId: string | undefined;
  /** Profile preset a newly drawn way starts with ("4-lane arterial", …);
   *  null = the way type's default profile. Reset when the way type changes. */
  draftPresetId: string | null;
  /** Whether drawing a way also creates a service riding it. True is the
   *  Network-view "draw a line" experience; false draws BARE infrastructure —
   *  a plain street/track to run services over later (the Infrastructure
   *  view's Service picker offers "None", and roads default to it there). */
  draftServiceEnabled: boolean;
  /** True when newly drawn ways start ONE-WAY (travel = drawing direction)
   *  instead of the type's default two-way profile — the Direction toggle in
   *  the drawing tools, and what a right-clicked endpoint branch arms. */
  draftOneWay: boolean;
  /** Facility TYPE (catalog entrance/bikeDock/depot/…) the Facility tool places. */
  draftFacilityTypeId: string;
  /** True when the Facility tool is in COMPLEX mode (drawing a site boundary
   *  to build inside) instead of directly placing the selected facility type.
   *  Chosen from the tool's variant flyout, never a hidden default. */
  draftFacilityComplexMode: boolean;
  /** Non-null while armed to drop a new facility straight into this group's
   *  membership (the Inspector's "Place inside" flow) — the Facility tool's
   *  next click places-and-joins instead of starting a fresh complex. */
  placingFacilityForGroupId: string | null;
  /** Non-null while armed to add the next clicked station/facility to this
   *  group's membership (the Inspector's "Add existing" flow). */
  pickingMemberForGroupId: string | null;
  /** Non-null while armed to attach the next drawn way as a new pattern
   *  (branch) on this service (the Inspector's "Add branch" flow). */
  addingPatternForServiceId: string | null;
  /** True when viewing a shared snapshot — editing is disabled until forked. */
  readOnly: boolean;
  /** Whether there's a prior/later system snapshot to restore. Kept in state
   *  (rather than derived on read) purely so components can subscribe to it
   *  to enable/disable Undo/Redo controls. */
  canUndo: boolean;
  canRedo: boolean;

  // system lifecycle
  setSystem: (system: TransitSystem, opts?: SetSystemOptions) => void;
  newSystem: () => void;
  setName: (name: string) => void;
  setViewport: (viewport: Viewport) => void;

  // history — every action that changes `system` is one undo step, EXCEPT
  // calls made between beginHistoryCheckpoint()/commitHistoryCheckpoint(),
  // which coalesce into a single step (a drag gesture firing many moveXPoint
  // calls should undo in one press, not one per pixel of movement).
  undo: () => void;
  redo: () => void;
  /** For pointer-gesture code (see map/interactions.ts): call at gesture
   *  start, then commitHistoryCheckpoint() on a normal end or
   *  cancelHistoryCheckpoint() on Escape. The explicit cancel restores the
   *  exact immutable starting snapshot without scanning agency-scale arrays. */
  beginHistoryCheckpoint: () => void;
  commitHistoryCheckpoint: () => void;
  cancelHistoryCheckpoint: () => void;

  // tools & selection
  setTool: (tool: Tool) => void;
  /** Picks what a Select press does. A held Alt or Ctrl is unaffected. */
  setSelectVariant: (variant: SelectVariant) => void;
  select: (selection: Selection) => void;
  setActivePattern: (patternId: string | null) => void;
  armTerminus: (terminus: NonNullable<EditorState['armedTerminus']>) => void;
  clearArmedTerminus: () => void;
  /** Same as select(), but also bumps cameraFocusToken so MapCanvas pans/
   *  fits the camera onto it — see cameraFocusToken's own doc comment for
   *  when to reach for this instead of plain select(). */
  selectAndFocus: (selection: Selection) => void;
  /** Adds/removes one item from the multi-select group, and nothing else.
   *  The programmatic form — a gesture that means "and this one too" wants
   *  extendSelection below. */
  toggleMultiSelect: (item: MultiSelectItem) => void;
  /** The grouping GESTURE: shift-click on the map, ctrl/cmd-click in the
   *  Objects list. Same as toggleMultiSelect, except that starting a group
   *  carries the current single selection into it — see its implementation
   *  for why the two are separate actions. */
  extendSelection: (item: MultiSelectItem) => void;
  /** Adds every given item to the multi-select group, deduplicated against
   *  what's already there (Shift-drag rubber-band select — see
   *  map/interactions.ts's startMarqueeSelect). Unlike toggleMultiSelect,
   *  this never REMOVES anything already selected; a marquee is a bulk-add
   *  gesture, not a bulk-toggle one — re-dragging a box over items you
   *  already had selected shouldn't silently drop them from the group. */
  addMultiSelection: (items: MultiSelectItem[]) => void;
  clearMultiSelection: () => void;
  /** Deletes every object currently in the multi-select group, as one undo step. */
  deleteMultiSelection: () => void;
  /** Translates the whole multi-select group by a fixed lng/lat delta —
   *  used by a group-drag gesture, called once per animation frame. */
  nudgeMultiSelection: (dx: number, dy: number) => void;
  setDraftWayType: (typeId: string) => void;
  /** Arm (or disarm) "keep this line's infrastructure separate" for the draw
   *  about to start. See draftSeparate. */
  setDraftSeparate: (separate: boolean) => void;
  setDraftMode: (modeId: string) => void;
  setDraftGeometry: (geometry: LineGeometry) => void;
  setDraftColor: (color: string) => void;
  setDraftGrade: (grade: Grade) => void;
  setDraftClassId: (classId: string | undefined) => void;
  setDraftPreset: (presetId: string | null) => void;
  setDraftServiceEnabled: (enabled: boolean) => void;
  setDraftOneWay: (on: boolean) => void;
  /** Start drawing a NEW one-way way branching off an existing way's open
   *  endpoint — the couplet gesture (right-click an endpoint): inherits the
   *  source way's cross-section (made one-way, travel = away from the
   *  branch point), type, grade, class, and shared street identity, and is
   *  joined to the source at that endpoint as a real junction. Returns the
   *  new way's id (it becomes the active draw). */
  beginOneWayBranch: (fromWayId: string, end: 'start' | 'end') => string | null;
  setDraftFacilityType: (typeId: string) => void;
  setDraftFacilityComplexMode: (on: boolean) => void;
  addPaletteColor: (color: string) => void;

  // way drawing (infrastructure, any type) — also creates a default service
  // when the way's type carries a mode-based service (rail/road/aerial/water).
  beginWay: (typeId?: string, geometry?: LineGeometry, color?: string) => string;
  // Resume drawing an existing, already-finished way (pressing near one of its
  // open endpoints) instead of starting an unrelated new one.
  resumeWay: (id: string) => void;
  addWayPoint: (wayId: string, coord: LngLat) => void;
  insertWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  moveWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  deleteWayPoint: (wayId: string, index: number) => void;
  /** Forms a real junction between (wayId, index) — already set to `coord` —
   *  and `targetWayId`: splices a genuine control point into the target way
   *  (or reuses one already there) and links both as one Node. */
  joinWayPointToWay: (wayId: string, index: number, targetWayId: string, coord: LngLat) => void;
  /** Closes a way back onto its own start with a real shared Node, once the
   *  caller has already made points[0] and the way's new last point
   *  coincide by coordinate (see resolveEnd's loop-close branch). */
  closeWayLoop: (wayId: string) => void;
  /** Drops every intermediate control point that isn't a junction, leaving a
   *  straight line between the way's endpoints (junction points are kept in
   *  place so connected ways don't desync). Cleanup for a wobbly freehand or
   *  imported alignment. */
  straightenWay: (wayId: string) => void;
  finishWay: () => void;
  setWayGeometry: (id: string, geometry: LineGeometry) => void;
  setWayGrade: (id: string, grade: Grade) => void;
  setWayClassId: (id: string, classId: string | undefined) => void;
  /** Physical capacity in the way type's unit (tracks/lanes/…) — drives the
   *  real cross-section fanned out in the Infrastructure view. */
  setWayCapacity: (id: string, capacity: number) => void;
  deleteWay: (id: string) => void;
  /** Splits a way in two at control point `index`, each half keeping the
   *  original's type/grade/class/capacity — see splitWay's doc comment. */
  splitWayAt: (wayId: string, index: number) => void;
  /** Divide a way at an arbitrary position along its resolved path, splicing
   *  a control point in first when the position falls between two. The
   *  index-based splitWayAt could only cut at a drag handle, which meant a
   *  street could not be divided where you clicked. No-op at either end,
   *  where there is nothing to cut off. */
  splitWayAtT: (wayId: string, t: number) => void;
  /** Append an OSM import's ways, the junctions between them, and the street
   *  identities spanning them as bare infrastructure — no service is
   *  auto-created, since imported streets/rail are real physical context to
   *  draw services over, not a route in themselves. The nodes come from OSM's
   *  own node identity (see model/import.ts), so an imported grid arrives
   *  connected and routable rather than as loose segments. Ways this system
   *  already imported are skipped rather than duplicated. A divided street
   *  arrives as a two-member identity with its median captured, ready for the
   *  carriageway tools. Returns what was added vs. skipped so the caller can
   *  say which happened. */
  importWays: (network: ImportedNetwork) => { added: number; skipped: number };
  /** Append a GTFS import's ways/services/stations (P4 follow-on: RTC's real
   *  system as a comparison baseline) — unlike importWays, this DOES create
   *  services/stations, since a GTFS feed is already a real rideable
   *  system, not bare infrastructure to draw over. */
  importGtfs: (pieces: GtfsImportPieces) => void;
  /** Apply a background batch only while its original document is active.
   * Switching systems cancels the import instead of contaminating the newly
   * opened document with a late Worker message. */
  applyGtfsImportBatch: (request: ApplyGtfsImportBatch) => boolean;

  // cross-sections (lane-level editing — see model/profile.ts)
  /** Replace a way's whole cross-section (the lane editor's setter). */
  setWayProfile: (id: string, profile: CrossSection) => void;
  /** Apply a catalog profile preset ("4-lane arterial", …) — also takes the
   *  preset's facility class when it declares one. */
  applyProfilePreset: (id: string, presetId: string) => void;

  // shared identity (NamedWay — "Decatur Avenue" across many way records)
  /** Name a way: joins an existing identity with that exact name, renames
   *  the identity the way already belongs to, or creates a new one. An empty
   *  name removes the way from its identity. */
  nameWay: (wayId: string, name: string) => void;
  renameNamedWay: (id: string, name: string) => void;

  // junction semantics (Node)
  setNodeControl: (nodeId: string, control: NodeControl | undefined) => void;
  /** Store an explicit lane-connectivity graph for a junction; undefined
   *  reverts it to heuristic-derived connectors. */
  setNodeConnectors: (nodeId: string, connectors: LaneConnector[] | undefined) => void;
  /** Take one way out of a junction. Its control point moves clear of the
   *  others, so nothing is left sharing the coordinate; a junction down to a
   *  single arm stops existing, and the selection clears with it. */
  disconnectNodeWay: (nodeId: string, wayId: string) => void;
  /** Traffic control for one specific approach, overriding the node's
   *  whole-node control for that arm only; undefined clears the override. */
  setApproachControl: (
    wayId: string,
    end: 'start' | 'end',
    control: NodeControl | undefined,
  ) => void;

  // turn restrictions (see model/system.ts's TurnRestriction)
  /** Restrict which target Ways a lane may feed at its next junction;
   *  undefined removes the restriction (unrestricted again). An empty array
   *  fully blocks the lane — how modal filters are expressed. */
  setTurnRestriction: (wayId: string, laneId: string, allowedTargets: string[] | undefined) => void;

  // regional driving convention (see model/system.ts's DrivingSide)
  setDrivingSide: (side: DrivingSide) => void;

  // road-network topology
  /** Form real junctions wherever this way crosses same-grade ways
   *  mid-segment — see formCrossingJunctions' doc comment. */
  formCrossingJunctions: (wayId: string, onlyWithWayId?: string) => void;
  /** End-to-end inverse of splitWayAt — see mergeWays' doc comment. */
  mergeWays: (keepWayId: string, otherWayId: string) => void;
  /** Split a two-way way into two one-way carriageway ways around a median
   *  gap, both under one shared identity. Returns the new (opposite-
   *  direction) way's id, or null when the way is one-way already. */
  separateCarriageways: (wayId: string) => string | null;
  /** Merge a shared identity's two one-way carriageways back into one
   *  two-way way (the forward carriageway's alignment wins). */
  combineCarriageways: (namedWayId: string) => void;
  /** Set (or clear, passing undefined) a NamedWay's median width — editable
   *  independent of dragging the carriageways apart; see model/system.ts's
   *  Median. */
  setMedianWidth: (namedWayId: string, widthM: number | undefined) => void;

  // routing over existing infrastructure (Network view's snap-to-streets
  // line drawing, and re-binding a sketched service onto real ways)
  /** Live route-drawing state: mode being drawn, the last committed anchor,
   *  and the spans accumulated so far. Null when not route-drawing. */
  routeDraft: {
    modeId: string;
    lastAnchor: RouteAnchor;
    spans: RouteSpan[];
    /** What committing this draft should do. Absent = mint a new service,
     *  which is what every draft did before couplets existed. */
    returnFor?: { serviceId: string; patternId: string };
  } | null;
  startRouteDraft: (anchor: RouteAnchor) => void;
  /** Route from the last anchor to `anchor` along existing compatible ways
   *  and append it. Returns false (no state change) when no path exists or
   *  the extension would traverse a way twice. */
  extendRouteDraft: (anchor: RouteAnchor) => boolean;
  /** Materialize the drafted route into a new service riding those ways. */
  commitRouteDraft: () => string | null;
  cancelRouteDraft: () => void;
  /** Create a service over an explicit routed span list (commitRouteDraft's
   *  backend; exposed for tests). */
  createRoutedService: (spans: RouteSpan[], modeId?: string) => string | null;
  /** Re-bind every pattern of a sketched service onto EXISTING infrastructure:
   *  routes between the pattern's endpoints along compatible ways (biased to
   *  follow the sketch corridor), swaps the pattern onto them, re-anchors
   *  stations, and deletes the now-orphaned sketch ways. Returns how many
   *  patterns were rebound. */
  adoptExistingInfrastructure: (serviceId: string) => number;
  /** Import-time corridor conflation: for each given service's pattern(s),
   *  detects interior stretches that run along already-existing compatible
   *  infrastructure (including ways an earlier pattern in THIS call already
   *  materialized) and rebinds them to share it, deleting the now-redundant
   *  solo way it replaces. Processes longest-pattern-first so a long trunk
   *  route seeds the canonical shared way. Returns how many patterns were
   *  reconciled onto shared infrastructure. */
  reconcileImportedServices: (serviceIds: string[]) => number;
  /** Commit a Worker result only when no edit replaced its input snapshot. */
  applyImportedReconciliation: (request: ApplyImportedReconciliation) => boolean;

  // services (colored routes over ways). Returns null when the way's type has
  // no compatible service modes (e.g. bike infrastructure carries no service).
  addServiceToWay: (wayId: string) => string | null;
  setServiceName: (id: string, name: string) => void;
  setServiceColor: (id: string, color: string) => void;
  setServiceMode: (id: string, modeId: string) => void;
  /** Peak headway in minutes — undefined clears it (not yet specified). */
  setServiceFrequency: (id: string, minutes: number | undefined) => void;
  /** Span of service — first/last departure, 24h "HH:MM"; undefined clears. */
  setServiceSpan: (id: string, start: string | undefined, end: string | undefined) => void;
  /** Replaces the full detailed schedule (see SchedulePeriod) in one shot —
   *  ScheduleDialog owns the add/edit/remove-row logic locally and commits
   *  the whole array here rather than the store exposing one action per
   *  row-level edit. undefined/[] reverts the service to its plain
   *  frequencyMinutes/spanStart/spanEnd pair. */
  setServiceSchedule: (id: string, periods: SchedulePeriod[] | undefined) => void;
  /** Replaces the system's whole vehicle-kind list in one shot — same
   *  live-commit convention as setServiceSchedule; VehicleKindsDialog owns
   *  add/edit/delete locally. */
  setVehicleKinds: (kinds: VehicleKind[]) => void;
  /** Assigns (or clears, with undefined) which VehicleKind a service runs. */
  setServiceVehicleKind: (id: string, vehicleKindId: string | undefined) => void;
  deleteService: (id: string) => void;
  /** Arm the Way tool so the next line drawn attaches as a new PATTERN
   *  (branch) on this service instead of spawning its own service. */
  startAddingPattern: (serviceId: string) => void;
  cancelAddingPattern: () => void;
  /** No-op if it's the service's only pattern — use deleteService instead. */
  deletePattern: (serviceId: string, patternId: string) => void;
  /** Turnkey "combine two lines into one branched corridor": every pattern
   *  from `sourceId` joins `targetId`'s own patterns (named after the source
   *  service if it doesn't already have its own pattern names, so the
   *  branch list stays legible), then the now-empty source service is
   *  deleted. No-op across different modes — a bus line and a rail line
   *  can't become branches of the same physical corridor. */
  mergeServiceInto: (sourceId: string, targetId: string) => void;
  /** Join two lines that meet end to end into ONE continuous line, keeping
   *  `keepId`'s identity — as opposed to mergeServiceInto, which makes them
   *  two branches of one service. Returns false and changes nothing when the
   *  modes differ, the ends don't meet, or no infrastructure connects them;
   *  see core's throughRouteServices for why the last one refuses rather than
   *  leaving a gap. */
  throughRouteInto: (keepId: string, otherId: string) => boolean;

  // editing a line in pieces (see model/patternEdits.ts)
  /** Cut a line back so it terminates at position `t` on one of the ways it
   *  runs over, dropping the stretch beyond that in ride order. The
   *  infrastructure is untouched — this shortens the line, not the street.
   *  `side` is which end of the line moves. */
  trimPatternTo: (
    serviceId: string,
    patternId: string,
    wayId: string,
    t: number,
    side: 'start' | 'end',
  ) => boolean;
  /** Exact-occurrence counterpart for a rendered line gesture. */
  trimPatternAt: (serviceId: string, position: PatternPosition, side: 'start' | 'end') => boolean;
  /** Add routed legs beyond one terminus without changing the infrastructure
   * those legs run over. Returns false when the route cannot materialize. */
  extendPatternTerminus: (
    serviceId: string,
    patternId: string,
    side: 'start' | 'end',
    spans: RouteSpan[],
  ) => boolean;
  /** Apply the stateless plan shown by a Network terminus drag. The complete
   * service/topology result lands in one store write, so one undo restores the
   * exact pre-gesture snapshot. A chooser plan remains inert until `choice`
   * names the operation. */
  commitTerminusGesture: (
    source: TerminusGestureSource,
    target: TerminusGestureTarget,
    plan: TerminusGesturePlan,
    choice?: 'connect' | 'through',
  ) => boolean;
  /** End one pattern at an exact displayed occurrence, keeping the longer
   * operating half. Returns false when that hit cannot make two valid halves. */
  endPatternAt: (serviceId: string, position: PatternPosition) => boolean;
  /** Divide the focused pattern at its exact displayed occurrence. The longer
   * half remains on this service; the shorter becomes a selected new service. */
  divideServiceAt: (serviceId: string, position: PatternPosition) => string | null;
  /** Cut a line in two at position `t` on one of its ways. The shorter half
   *  becomes a new service with its own name and colour, riding the same
   *  infrastructure; both halves keep their schedule. Returns the new
   *  service's id, or null when the cut lands on a terminus and there is
   *  nothing to split. */
  splitServiceAt: (serviceId: string, patternId: string, wayId: string, t: number) => string | null;
  /** Stop calling at a station in ONE direction, or call there again. Only
   *  meaningful on a stretch both directions ride: where they ride different
   *  ways the stop derivation already tells them apart. */
  setStopSkipped: (
    serviceId: string,
    patternId: string,
    run: RunDirection,
    stationId: string,
    skipped: boolean,
  ) => void;
  /** Start drawing this pattern's return path, from the far end of its
   *  outward trip. The draft routes direction-aware like any other, and
   *  committing it turns the covered stretch into a one-way couplet. */
  startReturnPathDraft: (serviceId: string, patternId: string) => boolean;
  /** Attach a drawn return path to a pattern, turning the stretch it parallels
   *  into a couplet. Returns false when the path cannot be resolved or does
   *  not rejoin the outward trip. */
  attachReturnPath: (serviceId: string, patternId: string, spans: RouteSpan[]) => boolean;
  /** Undo a couplet: both directions ride the outward trip's streets again. */
  makePatternTwoWay: (serviceId: string, patternId: string) => void;
  /** Take a stretch of a way out of existence: the way is cut around it and
   *  the middle removed, and every line riding it is trimmed to match. A line
   *  the stretch cut through survives as two patterns on the same service
   *  rather than losing whichever half was shorter. Returns how many patterns
   *  were affected. */
  deleteWayStretch: (wayId: string, fromT: number, toT: number) => number;
  /** Fuse the given ways into shared infrastructure wherever they run along
   *  each other — for a map drawn before lines shared by default, where the
   *  same corridor exists two or three times over. The longest way is kept and
   *  the others' lines are rebound onto it; a way nothing rides afterwards is
   *  removed, unless it was imported or named. Ways that don't actually run
   *  along each other are left alone. Returns how many were absorbed. */
  mergeWaysIntoCorridor: (wayIds: string[]) => number;

  // stations (ride on ways)
  addStation: (coord: LngLat, anchor?: StationAnchor) => string;
  /** The Station tool's DRAW gesture: a dragged-out footprint becomes a real
   *  station — coord at the footprint's center, anchored onto the nearest
   *  way it straddles (if any), footprint attached and ready for platforms.
   *  Click-to-place quick stops still go through addStation. */
  addDrawnStation: (footprint: LngLat[]) => string;
  /** Clears focusNameStationId once StationInspector has actually focused
   *  the name field for it — a no-op if it's already been consumed (or was
   *  never for this id), so it's safe to call unconditionally on mount. */
  consumeFocusName: (id: string) => void;
  moveStation: (id: string, coord: LngLat, anchor?: StationAnchor) => void;
  setStationName: (id: string, name: string) => void;
  /** How long a vehicle dwells here before departing, in seconds — undefined
   *  reverts to the animation's own default (see sim/vehicles.ts). */
  setStationDwellSeconds: (id: string, seconds: number | undefined) => void;
  setStationMajorStop: (id: string, major: boolean) => void;
  deleteStation: (id: string) => void;

  // station footprints & platforms (infrastructure-view physical planning) —
  // drawing starts from a default square the user drags into shape via the
  // same reshape-handle interaction as everything else.
  addStationFootprint: (stationId: string) => void;
  moveFootprintPoint: (stationId: string, index: number, coord: LngLat) => void;
  deleteStationFootprint: (stationId: string) => void;
  addPlatform: (stationId: string) => string;
  movePlatformPoint: (stationId: string, platformId: string, index: number, coord: LngLat) => void;
  deletePlatform: (stationId: string, platformId: string) => void;

  // facilities (catalog-typed point features: entrances, bike docks, depots, …)
  addFacility: (typeId: string, geometry: LngLat | LngLat[]) => string;
  moveFacility: (id: string, geometry: LngLat) => void;
  setFacilityName: (id: string, name: string) => void;
  deleteFacility: (id: string) => void;

  // groups (bundle any objects into one unit: a transfer complex, a line family, …)
  createGroup: (memberIds: string[], name?: string) => string;
  addGroupMember: (groupId: string, memberId: string) => void;
  removeGroupMember: (groupId: string, memberId: string) => void;
  renameGroup: (id: string, name: string) => void;
  setGroupColor: (id: string, color: string) => void;
  deleteGroup: (id: string) => void;

  // facility complexes — a Group with a physical footprint, built up by
  // placing new facilities inside it or grouping existing map objects
  // (see Toolbar's Facility tool + Inspector's GroupInspector).
  /** The Facility tool's drawn boundary (drag = rectangle, click-points =
   *  polygon — see map/interactions.ts) becomes a new complex's footprint,
   *  selected and ready for "Place inside". Assigns a color not already used
   *  by another complex, so complexes stay visually distinct on the map. */
  createFacilityComplex: (footprint: LngLat[]) => string;
  addGroupFootprint: (groupId: string) => void;
  moveGroupFootprintPoint: (groupId: string, index: number, coord: LngLat) => void;
  deleteGroupFootprint: (groupId: string) => void;
  /** Arm the Facility tool to place-and-join instead of starting a new complex. */
  startPlacingFacility: (groupId: string) => void;
  cancelPlacingFacility: () => void;
  placeFacilityInGroup: (groupId: string, typeId: string, coord: LngLat) => string;
  /** Arm Select to add the next clicked station/facility to this group. */
  startPickingMember: (groupId: string) => void;
  cancelPickingMember: () => void;
}

export type EditorStore = ReturnType<typeof createEditorStore>;

function centroidOf(ring: LngLat[]): LngLat {
  const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const cy = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  return [cx, cy];
}

function touch(system: TransitSystem): TransitSystem {
  // Lane-keyed components are pruned here rather than in each action that
  // can invalidate one, because the list of those actions is long and open:
  // deleting a way, merging two, applying a preset, stepping the lane count,
  // separating carriageways. Missing one leaves an invisible entry that a
  // later lane reusing the id silently inherits, and that survives a save.
  // Free when nothing is restricted, which is the overwhelming common case —
  // prunedToLiveLanes returns the same reference when every key is live.
  const turnRestrictions = prunedToLiveLanes(system.turnRestrictions, system.ways);
  return { ...system, turnRestrictions, updatedAt: Date.now() };
}

// Recompute the coords of every station riding `wayId`, so they follow the
// way when its control points move.
function reanchorStations(system: TransitSystem, wayId: string): Station[] {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way) return system.stations;
  const path = resolveWayPath(way);
  if (path.length < 2) return system.stations;
  return system.stations.map((s) =>
    anchorOnWayId(s, wayId) ? { ...s, coord: pointAtT(path, anchorOnWayId(s, wayId)!.t) } : s,
  );
}

function updateWayPoints(
  system: TransitSystem,
  wayId: string,
  fn: (points: LngLat[]) => LngLat[],
): TransitSystem {
  const ways = system.ways.map((w) => (w.id === wayId ? { ...w, points: fn(w.points) } : w));
  const withWays = { ...system, ways };
  return { ...withWays, stations: reanchorStations(withWays, wayId), updatedAt: Date.now() };
}

// Same transform as calling updateWayPoints once per way in `wayIds`, but in
// ONE pass over `ways` and ONE pass over `stations` instead of one of each
// per way — a multi-way group-drag calling updateWayPoints per selected way
// costs O(k × (totalWays + totalStations)) per animation frame; this is
// O(totalWays + totalStations) regardless of k. Each way's transform is
// independent and each station only ever reanchors off its own anchor way,
// so one combined pass produces byte-identical output to k sequential ones.
function updateWayPointsBatch(
  system: TransitSystem,
  wayIds: Set<string>,
  fn: (points: LngLat[]) => LngLat[],
): TransitSystem {
  if (wayIds.size === 0) return system;
  const changedWays = new Map<string, Way>();
  const ways = system.ways.map((w) => {
    if (!wayIds.has(w.id)) return w;
    const next = { ...w, points: fn(w.points) };
    changedWays.set(w.id, next);
    return next;
  });
  // Only allocate a new `stations` array when something actually reanchors.
  // Map projection and simulation caches use these immutable collection
  // identities to skip unrelated work after a group drag.
  let stationsChanged = false;
  const stations = system.stations.map((s) => {
    const anchor = primaryAnchor(s);
    const way = anchor && changedWays.get(anchor.wayId);
    if (!way || !anchor) return s;
    const path = resolveWayPath(way);
    if (path.length < 2) return s;
    stationsChanged = true;
    return { ...s, coord: pointAtT(path, anchor.t) };
  });
  return {
    ...system,
    ways,
    stations: stationsChanged ? stations : system.stations,
    updatedAt: Date.now(),
  };
}

// Drop every intermediate point that isn't a junction (keeps refs.length >= 2
// nodes intact), leaving a straight line — indices removed highest-first so
// each shiftNodeRefsForDelete sees indices that haven't shifted yet.
function straightenWay(system: TransitSystem, wayId: string): TransitSystem {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way || way.points.length <= 2) return system;
  const lastIndex = way.points.length - 1;
  const junctionIndexes = new Set(
    system.nodes.flatMap((n) => n.refs.filter((r) => r.wayId === wayId).map((r) => r.pointIndex)),
  );
  const removable = way.points
    .map((_, i) => i)
    .filter((i) => i !== 0 && i !== lastIndex && !junctionIndexes.has(i))
    .sort((a, b) => b - a);
  let next = system;
  for (const index of removable) {
    next = {
      ...updateWayPoints(next, wayId, (pts) => pts.filter((_, i) => i !== index)),
      nodes: shiftNodeRefsForDelete(next.nodes, wayId, index),
    };
  }
  return next;
}

// Drop a way from every shared identity, and drop identities left empty.
function pruneNamedWays(namedWays: NamedWay[], wayId: string): NamedWay[] {
  return namedWays
    .map((n) => ({ ...n, wayIds: n.wayIds.filter((id) => id !== wayId) }))
    .filter((n) => n.wayIds.length > 0);
}

// Drop lane connectors that reference a way (it's gone, or its lanes are).
function pruneConnectorsForWay(nodes: Node[], wayId: string): Node[] {
  return nodes.map((n) => {
    if (!n.connectors) return n;
    const connectors = n.connectors.filter((c) => c.from.wayId !== wayId && c.to.wayId !== wayId);
    return connectors.length === n.connectors.length
      ? n
      : { ...n, connectors: connectors.length > 0 ? connectors : undefined };
  });
}

// Remove a way, detach it from every service's patterns, and delete the
// stations that rode it.
//
// A pattern is TRIMMED rather than merely stripped of the way: dropping a leg
// out of the middle of a route leaves the two halves unjoined, and a pattern
// that describes a path with a hole in it is one validateSystem reports. The
// longer surviving run is kept, so deleting one block of a long line shortens
// the line instead of destroying it — and deleting a line's only way still
// removes the line, which is what the way tool's own delete has always meant.
// Cutting a line deliberately and keeping BOTH halves is deleteWayStretch's
// job, not this one.
/**
 * A station's anchors with the one on `replacedWayId` swapped for `next`, or
 * `next` appended when it rode no such way.
 *
 * Anchors are a list now, and `{ ...station, anchor: x }` silently writes a
 * dead property while the real list keeps a stale entry pointing at a way that
 * is about to stop existing. Every re-anchor goes through here so that cannot
 * happen — and so a station riding a SECOND way keeps that anchor, which is
 * the whole reason the list exists.
 */
function reanchored(station: Station, replacedWayId: string, next: StationAnchor): StationAnchor[] {
  const kept = station.anchors.filter((a) => a.wayId !== replacedWayId && a.wayId !== next.wayId);
  return [next, ...kept];
}

function removeWay(system: TransitSystem, wayId: string): TransitSystem {
  const ways = system.ways.filter((w) => w.id !== wayId);
  const services = system.services
    .map((s) => ({
      ...s,
      patterns: s.patterns
        .map((p) => {
          const filtered = mapSectionLegs(p.sections, (legs) =>
            legs.filter((l) => l.wayId !== wayId),
          );
          if (patternLegs({ ...p, sections: filtered }).length === patternLegs(p).length) return p;
          // Only once something was actually removed: a pattern that already
          // had a break in it should keep it rather than be silently halved.
          // Each section keeps its own longest continuous run, since a
          // couplet's two halves break independently.
          const sections = pruneSections(
            mapSectionLegs(filtered, (legs) => {
              const runs = splitLegsIntoRuns(legs, (a, b) => legsMeet(ways, a, b));
              return runs.reduce(
                (best, run) => (run.length > best.length ? run : best),
                [] as PatternLeg[],
              );
            }),
          );
          return { ...p, sections };
        })
        .filter((p) => patternLegs(p).length > 0),
    }))
    .filter((s) => s.patterns.length > 0);
  return {
    ...system,
    ways,
    services,
    // A station riding another way as well survives, losing only this anchor —
    // deleting one carriageway must not delete a platform the other still serves.
    stations: system.stations
      .filter((s) => !(s.anchors.length === 1 && s.anchors[0].wayId === wayId))
      .map((s) =>
        anchorOnWayId(s, wayId) ? { ...s, anchors: s.anchors.filter((a) => a.wayId !== wayId) } : s,
      ),
    nodes: pruneConnectorsForWay(removeNodeRefsForWay(system.nodes, wayId), wayId),
    namedWays: pruneNamedWays(system.namedWays, wayId),
  };
}

// ---- junctions (Node) -----------------------------------------------------
// A Node records a control point genuinely shared by 2+ ways (see
// model/system.ts). Every mutation that inserts, deletes, or moves a way's
// control points must keep `refs` in sync, or a junction silently desyncs —
// the exact bug this primitive fixes (see the plan doc).

function shiftNodeRefsForInsert(nodes: Node[], wayId: string, atIndex: number): Node[] {
  return nodes.map((n) => ({
    ...n,
    refs: n.refs.map((r) =>
      r.wayId === wayId && r.pointIndex >= atIndex ? { ...r, pointIndex: r.pointIndex + 1 } : r,
    ),
  }));
}

function shiftNodeRefsForDelete(nodes: Node[], wayId: string, index: number): Node[] {
  return nodes
    .map((n) => ({
      ...n,
      refs: n.refs
        .filter((r) => !(r.wayId === wayId && r.pointIndex === index))
        .map((r) =>
          r.wayId === wayId && r.pointIndex > index ? { ...r, pointIndex: r.pointIndex - 1 } : r,
        ),
    }))
    .filter((n) => n.refs.length >= 2); // fewer than 2 refs isn't a junction anymore
}

function removeNodeRefsForWay(nodes: Node[], wayId: string): Node[] {
  return nodes
    .map((n) => ({ ...n, refs: n.refs.filter((r) => r.wayId !== wayId) }))
    .filter((n) => n.refs.length >= 2);
}

// Moving a point that belongs to a Node must move EVERY way's coincident
// point, not just the one dragged — otherwise the junction desyncs.
function cascadeMove(
  system: TransitSystem,
  wayId: string,
  index: number,
  coord: LngLat,
): TransitSystem {
  const node = system.nodes.find((n) =>
    n.refs.some((r) => r.wayId === wayId && r.pointIndex === index),
  );
  if (!node)
    return updateWayPoints(system, wayId, (pts) => pts.map((p, i) => (i === index ? coord : p)));

  let ways = system.ways;
  for (const ref of node.refs) {
    ways = ways.map((w) =>
      w.id === ref.wayId
        ? { ...w, points: w.points.map((p, i) => (i === ref.pointIndex ? coord : p)) }
        : w,
    );
  }
  const nodes = system.nodes.map((n) => (n.id === node.id ? { ...n, coord } : n));
  let next: TransitSystem = { ...system, ways, nodes };
  for (const ref of node.refs) next = { ...next, stations: reanchorStations(next, ref.wayId) };
  return { ...next, updatedAt: Date.now() };
}

// Existing control point on the target way this close to a snap coordinate is
// reused instead of inserting a near-duplicate point beside it.
const JOIN_REUSE_TOLERANCE_M = 0.75;

/**
 * Form a real junction: splice an actual control point into `targetWayId`'s
 * raw points (or reuse one already there) at `coord`, then link it and
 * (`wayId`, `index`) — which the caller must already have set to `coord` —
 * as refs of a shared Node. This is what makes two ways drawn to "meet" share
 * a literal coordinate on both sides, not just a coincidental-looking curve.
 */
function joinWayPointToWay(
  system: TransitSystem,
  wayId: string,
  index: number,
  targetWayId: string,
  coord: LngLat,
): TransitSystem {
  if (wayId === targetWayId) return system;
  const targetWay = system.ways.find((w) => w.id === targetWayId);
  if (!targetWay) return system;

  let targetIndex = targetWay.points.findIndex(
    (p) => haversineMeters(p, coord) <= JOIN_REUSE_TOLERANCE_M,
  );
  let ways = system.ways;
  let nodes = system.nodes;
  let exactCoord = coord;

  if (targetIndex === -1) {
    const insertion = nearestInsertionPoint(targetWay.points, coord);
    if (!insertion) return system; // target way has fewer than 2 points — nothing to join onto
    targetIndex = insertion.index;
    exactCoord = insertion.coord;
    ways = ways.map((w) =>
      w.id === targetWayId
        ? {
            ...w,
            points: [...w.points.slice(0, targetIndex), exactCoord, ...w.points.slice(targetIndex)],
          }
        : w,
    );
    nodes = shiftNodeRefsForInsert(nodes, targetWayId, targetIndex);
  } else {
    exactCoord = targetWay.points[targetIndex];
  }

  // Keep our own way's point exactly coincident even if the caller's snapped
  // coordinate (computed off the curve-resolved path) drifted slightly from
  // the target way's actual raw control point.
  ways = ways.map((w) =>
    w.id === wayId ? { ...w, points: w.points.map((p, i) => (i === index ? exactCoord : p)) } : w,
  );

  const existingNode = nodes.find((n) =>
    n.refs.some((r) => r.wayId === targetWayId && r.pointIndex === targetIndex),
  );
  if (existingNode) {
    const alreadyLinked = existingNode.refs.some(
      (r) => r.wayId === wayId && r.pointIndex === index,
    );
    nodes = nodes.map((n) =>
      n.id === existingNode.id && !alreadyLinked
        ? { ...n, refs: [...n.refs, { wayId, pointIndex: index }] }
        : n,
    );
  } else {
    nodes = [
      ...nodes,
      {
        id: shortId(),
        coord: exactCoord,
        refs: [
          { wayId: targetWayId, pointIndex: targetIndex },
          { wayId, pointIndex: index },
        ],
      },
    ];
  }

  let next: TransitSystem = { ...system, ways, nodes };
  next = { ...next, stations: reanchorStations(next, targetWayId) };
  next = { ...next, stations: reanchorStations(next, wayId) };
  return { ...next, updatedAt: Date.now() };
}

// Same-way counterpart to joinWayPointToWay: closing a way back onto its own
// start needs a real shared Node linking index 0 to the new last index, or
// the ring is just two coincident points — visually closed but disconnected
// for routing/lane-graph purposes. joinWayPointToWay can't be reused directly
// since it guards wayId === targetWayId (built for merging distinct ways).
// Assumes the caller already appended/prepended the closing point so
// points[0] and points[last] are coincident by coordinate.
function closeWayLoop(system: TransitSystem, wayId: string): TransitSystem {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way || way.points.length < 2) return system;
  const lastIndex = way.points.length - 1;
  const coord = way.points[0];
  const existingNode = system.nodes.find((n) =>
    n.refs.some((r) => r.wayId === wayId && r.pointIndex === 0),
  );
  let nodes = system.nodes;
  if (existingNode) {
    const alreadyLinked = existingNode.refs.some(
      (r) => r.wayId === wayId && r.pointIndex === lastIndex,
    );
    nodes = alreadyLinked
      ? nodes
      : nodes.map((n) =>
          n.id === existingNode.id
            ? { ...n, refs: [...n.refs, { wayId, pointIndex: lastIndex }] }
            : n,
        );
  } else {
    nodes = [
      ...nodes,
      {
        id: shortId(),
        coord,
        refs: [
          { wayId, pointIndex: 0 },
          { wayId, pointIndex: lastIndex },
        ],
      },
    ];
  }
  return { ...system, nodes, updatedAt: Date.now() };
}

/**
 * How far a way's control point moves when it leaves a junction.
 *
 * Removing the shared ref alone would leave the two points still sitting on
 * the same coordinate: the map still draws one meeting of two corridors, and
 * a reload re-derives the junction outright, because serialize.ts buckets
 * coordinates to NODE_COORD_PRECISION (~0.11 m) to decide what is coincident.
 * 12 m clears that bucket by two orders of magnitude and reads as a real gap
 * at street-level zoom, while being short enough not to visibly bend the way
 * it moves. It is deliberately unrelated to MAX_SNAP_M (50 m): disconnecting
 * is not a drag gesture, so nothing re-snaps the point afterwards.
 */
const DISCONNECT_NUDGE_M = 12;

/** Unit vectors pointing away from `origin` along each side of one arm — two
 *  for a way passing through the junction, one for a way ending at it. */
function armTangentsAt(
  system: TransitSystem,
  origin: LngLat,
  ref: WayPointRef,
): [number, number][] {
  const way = system.ways.find((w) => w.id === ref.wayId);
  if (!way) return [];
  const tangents: [number, number][] = [];
  for (const neighbor of [way.points[ref.pointIndex - 1], way.points[ref.pointIndex + 1]]) {
    if (!neighbor) continue;
    const [dx, dy] = metersFromOrigin(origin, neighbor);
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    tangents.push([dx / length, dy / length]);
  }
  return tangents;
}

/**
 * Which way a leaving arm's point moves: opposite the sum of every remaining
 * arm's tangents, so the point retreats from wherever the junction's other
 * corridors continue. At a 4-arm cross that is straight back down the arm
 * being removed; at an end-to-end joint it is back along the way that stays.
 *
 * A way running STRAIGHT THROUGH the junction contributes two opposed
 * tangents that cancel, which is honest — the junction offers no side to
 * retreat towards — so the arm falls back to backing off along its own
 * alignment, which separates the two points without bending either way.
 */
function disconnectDirection(
  system: TransitSystem,
  origin: LngLat,
  staying: WayPointRef[],
  leaving: WayPointRef[],
): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const ref of staying) {
    for (const [dx, dy] of armTangentsAt(system, origin, ref)) {
      sx += dx;
      sy += dy;
    }
  }
  const length = Math.hypot(sx, sy);
  if (length > 1e-6) return [-sx / length, -sy / length];
  const own = leaving.flatMap((ref) => armTangentsAt(system, origin, ref))[0];
  // Both sides degenerate only for a way with no usable neighbouring point at
  // all, which cannot render anyway; any direction separates the points.
  return own ?? [1, 0];
}

/** `node` with `wayId` gone from both its arms and its lane graph. A
 *  connector naming a way that no longer meets here would break
 *  junctionGeometry, which resolves every connector endpoint against a live
 *  arm. */
function nodeWithoutWay(node: Node, wayId: string, refs: WayPointRef[]): Node {
  const connectors = node.connectors?.filter((c) => c.from.wayId !== wayId && c.to.wayId !== wayId);
  return { ...node, refs, connectors: connectors?.length ? connectors : undefined };
}

/**
 * Take one way out of a junction: the inverse of joinWayPointToWay, and
 * written the same way — a private pure transform over a TransitSystem, with
 * a same-named store action wrapping it.
 *
 * The leaving way's control point is NUDGED, not merely unlinked. Leaving it
 * coincident would keep drawing a junction that no longer exists in the
 * model, and serialize.ts would re-derive one on the next load. The arms that
 * stay never move.
 *
 * One path covers every junction, not just the 2-arm case the bug report
 * showed: a 6-arm intersection sheds one arm and keeps standing, a 2-arm one
 * drops to a single ref and stops being a junction at all — a way passing
 * through a point on its own is not one.
 */
function disconnectWayFromNode(
  system: TransitSystem,
  nodeId: string,
  wayId: string,
): TransitSystem {
  const node = system.nodes.find((n) => n.id === nodeId);
  if (!node) return system;
  // A way that touches the same junction twice (a loop closing on itself)
  // leaves by both refs at once — one of them staying behind would leave the
  // junction half-disconnected, which no UI can then describe.
  const leaving = node.refs.filter((r) => r.wayId === wayId);
  const staying = node.refs.filter((r) => r.wayId !== wayId);
  if (leaving.length === 0) return system;

  const [dx, dy] = disconnectDirection(system, node.coord, staying, leaving);
  const moved = new Set(leaving.map((r) => r.pointIndex));
  const ways = system.ways.map((w) =>
    w.id === wayId
      ? {
          ...w,
          points: w.points.map((p, i) =>
            moved.has(i) ? offsetMeters(p, dx * DISCONNECT_NUDGE_M, dy * DISCONNECT_NUDGE_M) : p,
          ),
        }
      : w,
  );
  const nodes =
    staying.length < 2
      ? system.nodes.filter((n) => n.id !== nodeId)
      : system.nodes.map((n) => (n.id === nodeId ? nodeWithoutWay(n, wayId, staying) : n));

  const next: TransitSystem = { ...system, ways, nodes };
  // The moved point reshapes the way, so anything riding it by fraction-along
  // has to be re-measured — the same reason cascadeMove does this.
  return { ...next, stations: reanchorStations(next, wayId), updatedAt: Date.now() };
}

/**
 * Split a way into two at control point `index`: grade/class/capacity have
 * no way to change partway through an alignment otherwise (see the plan
 * doc). `wayId` keeps its id and becomes the first half (points[0..index]);
 * a new way becomes the second half (points[index..end]). Every riding
 * service now runs over both, in order — a fully drawn-through line still
 * looks and rides the same, just as two ways instead of one. The split point
 * becomes a real junction (a shared Node) even if it wasn't one already, and
 * every station that rode the original way is re-snapped onto whichever new
 * half its (unmoved) coordinate now actually sits on.
 */
function splitWay(
  system: TransitSystem,
  wayId: string,
  index: number,
  newWayId = shortId(),
): TransitSystem {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way || index <= 0 || index >= way.points.length - 1) return system; // each half needs ≥2 points
  const wayA: Way = { ...way, points: way.points.slice(0, index + 1) };
  const wayB: Way = { ...way, id: newWayId, points: way.points.slice(index) };
  const ways = [...system.ways.map((w) => (w.id === wayId ? wayA : w)), wayB];

  // Refs before the split stay on A; the split point itself gets linked to
  // BOTH A (unchanged) and B (index 0); refs after it move to B, reindexed.
  let nodes = system.nodes.map((n) => ({
    ...n,
    refs: n.refs.flatMap((r) => {
      if (r.wayId !== wayId) return [r];
      if (r.pointIndex < index) return [r];
      if (r.pointIndex === index) return [r, { wayId: newWayId, pointIndex: 0 }];
      return [{ wayId: newWayId, pointIndex: r.pointIndex - index }];
    }),
  }));
  const splitAlreadyLinked = nodes.some(
    (n) =>
      n.refs.some((r) => r.wayId === wayId && r.pointIndex === index) &&
      n.refs.some((r) => r.wayId === newWayId && r.pointIndex === 0),
  );
  if (!splitAlreadyLinked) {
    nodes = [
      ...nodes,
      {
        id: shortId(),
        coord: way.points[index],
        refs: [
          { wayId, pointIndex: index },
          { wayId: newWayId, pointIndex: 0 },
        ],
      },
    ];
  }

  const pathA = resolveWayPath(wayA);
  const pathB = resolveWayPath(wayB);

  // Where the split fell along the ORIGINAL way, as a fraction of its length.
  // Measured off the resolved path rather than computed from the control-point
  // index, because a curved way's rendered length isn't a straight sum over
  // its control points — and a leg's extent is measured against that rendered
  // length. Falls back to the pure length ratio if the projection fails, which
  // it can't for a way with two resolvable halves.
  const originalPath = resolveWayPath(way);
  const tSplit =
    nearestOnPath(originalPath, way.points[index])?.t ??
    pathLengthMeters(pathA) / Math.max(1e-9, pathLengthMeters(originalPath));
  const services = system.services.map((sv) => ({
    ...sv,
    patterns: sv.patterns.map((p) =>
      patternLegs(p).some((l) => l.wayId === wayId)
        ? {
            ...p,
            sections: normalizeSections(
              mapSectionLegs(p.sections, (legs) => splitLegs(legs, wayId, newWayId, tSplit)),
            ),
          }
        : p,
    ),
  }));

  const stations = system.stations.map((st) => {
    if (!anchorOnWayId(st, wayId)) return st;
    const onA = nearestOnPath(pathA, st.coord);
    const onB = nearestOnPath(pathB, st.coord);
    if (!onA && !onB) return st;
    const useB = !!onB && (!onA || onB.distMeters < onA.distMeters);
    const best = (useB ? onB : onA)!;
    return { ...st, anchors: reanchored(st, wayId, { wayId: useB ? newWayId : wayId, t: best.t }) };
  });

  // Both halves keep the original's lane ids (the profile is shared), so a
  // junction connector that referenced the original way stays valid — it just
  // has to point at whichever half actually reaches that junction now.
  nodes = nodes.map((n) => {
    if (!n.connectors) return n;
    const stillHasA = n.refs.some((r) => r.wayId === wayId);
    if (stillHasA) return n;
    return {
      ...n,
      connectors: n.connectors.map((c) => ({
        from: c.from.wayId === wayId ? { ...c.from, wayId: newWayId } : c.from,
        to: c.to.wayId === wayId ? { ...c.to, wayId: newWayId } : c.to,
      })),
    };
  });

  // The second half inherits the first's shared identity — a street split by
  // an intersection is still the same street.
  const namedWays = system.namedWays.map((nw) =>
    nw.wayIds.includes(wayId) ? { ...nw, wayIds: [...nw.wayIds, newWayId] } : nw,
  );

  return { ...system, ways, nodes, services, stations, namedWays, updatedAt: Date.now() };
}

/**
 * The inverse of splitWay: joins `otherId` onto `keepId` end-to-end into one
 * way (they must share an endpoint within tolerance and be the same type).
 * The merged way keeps `keepId`'s identity, orientation, and cross-section;
 * `otherId`'s point order is reversed when it ran the opposite direction.
 * Node refs are re-indexed onto the merged way (the seam node dissolves
 * unless a third way still meets there), services replace the pair with the
 * one way, and stations re-anchor by coordinate.
 */
function mergeWays(system: TransitSystem, keepId: string, otherId: string): TransitSystem {
  const a = system.ways.find((w) => w.id === keepId);
  const b = system.ways.find((w) => w.id === otherId);
  if (!a || !b || a.id === b.id || a.typeId !== b.typeId) return system;
  if (a.points.length < 2 || b.points.length < 2) return system;

  const aStart = a.points[0];
  const aEnd = a.points[a.points.length - 1];
  const bStart = b.points[0];
  const bEnd = b.points[b.points.length - 1];
  const aLen = a.points.length;
  const bLen = b.points.length;

  // The four ways two open polylines can meet end-to-end. Pick the closest.
  const combos = [
    { dist: haversineMeters(aEnd, bStart), key: 'ab' },
    { dist: haversineMeters(aEnd, bEnd), key: 'abR' },
    { dist: haversineMeters(aStart, bEnd), key: 'ba' },
    { dist: haversineMeters(aStart, bStart), key: 'bRa' },
  ].sort((x, y) => x.dist - y.dist);
  if (combos[0].dist > JOIN_REUSE_TOLERANCE_M) return system;

  const reversedB = [...b.points].reverse();
  let mergedPoints: LngLat[];
  let mapA: (i: number) => number;
  let mapB: (k: number) => number;
  switch (combos[0].key) {
    case 'ab':
      mergedPoints = [...a.points, ...b.points.slice(1)];
      mapA = (i) => i;
      mapB = (k) => aLen - 1 + k;
      break;
    case 'abR':
      mergedPoints = [...a.points, ...reversedB.slice(1)];
      mapA = (i) => i;
      mapB = (k) => aLen - 1 + (bLen - 1 - k);
      break;
    case 'ba':
      mergedPoints = [...b.points, ...a.points.slice(1)];
      mapB = (k) => k;
      mapA = (i) => bLen - 1 + i;
      break;
    default: // "bRa"
      mergedPoints = [...reversedB, ...a.points.slice(1)];
      mapB = (k) => bLen - 1 - k;
      mapA = (i) => bLen - 1 + i;
      break;
  }

  const mergedWay: Way = { ...a, points: mergedPoints };
  const ways = system.ways
    .filter((w) => w.id !== otherId)
    .map((w) => (w.id === keepId ? mergedWay : w));

  // Re-index every node ref onto the merged way, dedupe refs that now name
  // the same point (the seam), and drop nodes no longer joining 2+ refs.
  let nodes = system.nodes
    .map((n) => {
      const refs = n.refs.map((r) =>
        r.wayId === keepId
          ? { wayId: keepId, pointIndex: mapA(r.pointIndex) }
          : r.wayId === otherId
            ? { wayId: keepId, pointIndex: mapB(r.pointIndex) }
            : r,
      );
      const seen = new Set<string>();
      const deduped = refs.filter((r) => {
        const key = `${r.wayId}:${r.pointIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...n, refs: deduped };
    })
    .filter((n) => n.refs.length >= 2);
  // The other way's lanes are gone (the merged way keeps `keepId`'s
  // cross-section), so connectors referencing them can't survive.
  nodes = pruneConnectorsForWay(nodes, otherId);

  const mergedPath = resolveWayPath(mergedWay);

  // Services: the pair becomes the one merged way; collapse the adjacency and
  // remeasure every extent against the merged length. Positions are carried
  // across by coordinate — the same round-trip the station reanchor below
  // uses — rather than by arithmetic on the point-index maps, because that
  // holds whether or not the merge reversed a way and whether or not either
  // way is curved.
  const oldPaths = new Map([
    [keepId, resolveWayPath(a)],
    [otherId, resolveWayPath(b)],
  ]);
  const bReversed = combos[0].key === 'abR' || combos[0].key === 'bRa';
  const services = system.services.map((sv) => ({
    ...sv,
    patterns: sv.patterns.map((p) => ({
      ...p,
      // normalizeSections, because merging a couplet's two one-way streets into
      // one two-way street lands both directions on the same ground: the line
      // still runs out and back, but it is no longer split, and left as a split
      // the schematic draws one-way chevrons BOTH ways along one street.
      sections: normalizeSections(
        mapSectionLegs(p.sections, (legs) =>
          mergeLegs(legs, keepId, otherId, {
            positionOf: (wayId, t) => {
              const old = oldPaths.get(wayId);
              if (!old || old.length < 2) return t;
              return nearestOnPath(mergedPath, pointAtT(old, t))?.t ?? t;
            },
            reversed: (wayId) => wayId === otherId && bReversed,
          }),
        ),
      ),
    })),
  }));
  const stations = system.stations.map((st) => {
    if (!anchorOnWayId(st, keepId) && !anchorOnWayId(st, otherId)) return st;
    const on = nearestOnPath(mergedPath, st.coord);
    return on ? { ...st, anchors: reanchored(st, otherId, { wayId: keepId, t: on.t }) } : st;
  });

  const namedWays = pruneNamedWays(system.namedWays, otherId);

  return { ...system, ways, nodes, services, stations, namedWays, updatedAt: Date.now() };
}

/**
 * The SimCity moment: wherever `wayId` crosses another corridor of the SAME
 * type and grade
 * mid-segment, form a real 4-arm junction — a shared vertex spliced into
 * both ways, linked as one Node, then both ways split there so every arm is
 * its own way (which is what per-arm lane connectors and per-arm profile
 * edits need). Different types remain visually coincident until an explicit
 * compatible service connection joins them; different grades are overpasses.
 * Newly created arms are re-scanned, so a way crossing three streets forms
 * all three junctions.
 */
function formCrossingJunctions(
  system: TransitSystem,
  wayId: string,
  /** Restricts junction-forming to crossings with this one way. Undefined
   *  means every way it crosses, which is what finishing a draw wants. An
   *  explicit "connect these two streets" wants only the street the person
   *  picked — otherwise selecting two roads that both cross a third would
   *  quietly junction the third as well. */
  onlyWithWayId?: string,
): TransitSystem {
  let next = system;
  const queue: string[] = [wayId];
  let guard = 0; // hard stop far above any real drawing's crossing count
  while (queue.length > 0 && guard++ < 400) {
    const aId = queue.shift()!;
    const a = next.ways.find((w) => w.id === aId);
    if (!a || a.points.length < 2) continue;

    // Only ways sharing a grid cell with this one can cross it. Without this,
    // wayCrossings — a nested loop over every segment PAIR, with no bbox
    // reject — ran against every way in the system, on every finishWay. At
    // RTC scale (~120k points) drawing one line across a few streets was a
    // multi-second freeze. The grid is the same one snapping already
    // maintains, cached on the ways array, so this is a lookup rather than a
    // second index.
    const nearby = candidateWayIdsAlong(resolveWayPath(a), next.ways);
    let formed = false;
    for (const b of next.ways) {
      if (b.id === aId || b.typeId !== a.typeId || b.grade !== a.grade || b.points.length < 2)
        continue;
      if (onlyWithWayId && b.id !== onlyWithWayId) continue;
      if (!nearby.has(b.id)) continue;
      const crossings = wayCrossings(a, b);
      if (crossings.length === 0) continue;
      const { coord, aIndex } = crossings[0];

      // A real shared vertex on both ways, linked as one Node…
      const inserted = updateWayPoints(next, aId, (pts) => [
        ...pts.slice(0, aIndex),
        coord,
        ...pts.slice(aIndex),
      ]);
      next = { ...inserted, nodes: shiftNodeRefsForInsert(inserted.nodes, aId, aIndex) };
      next = joinWayPointToWay(next, aId, aIndex, b.id, coord);

      // …then split both ways there so each junction arm is its own way.
      const exact = next.ways.find((w) => w.id === aId)!.points[aIndex];
      const bWay = next.ways.find((w) => w.id === b.id)!;
      const bIndex = bWay.points.findIndex(
        (p) => haversineMeters(p, exact) <= JOIN_REUSE_TOLERANCE_M,
      );
      const aNewId = shortId();
      next = splitWay(next, aId, aIndex, aNewId);
      if (bIndex > 0 && bIndex < bWay.points.length - 1) next = splitWay(next, b.id, bIndex);

      queue.push(aId, aNewId);
      formed = true;
      break;
    }
    if (!formed) continue;
  }
  return next;
}

// ---- editing a line in pieces ----------------------------------------------

/** A stretch shorter than this is a mis-click, not a request. 0.1% of a way. */
const MIN_STRETCH_T = 1e-3;

/** A colour no service on this system is already using, so two lines are never
 *  indistinguishable. The configured palette is preferred, but edits must not
 *  collapse two services onto the mode default once that palette is exhausted. */
function unusedPaletteColor(system: TransitSystem, modeId: string): string {
  const used = new Set(system.services.map((s) => s.color.toLowerCase()));
  const paletteColor = system.palette.find((color) => !used.has(color.toLowerCase()));
  if (paletteColor) return paletteColor;
  const modeColor = modeRender(modeId).color;
  if (!used.has(modeColor.toLowerCase())) return modeColor;

  // The palette is a preference, not a cap on how many distinct services can
  // exist. Start at a stable value derived from the mode and probe the RGB
  // space, so the same document state always receives the same next colour.
  let start = 0;
  for (const char of modeId) start = (start * 31 + char.charCodeAt(0)) & 0xffffff;
  for (let offset = 0; offset <= 0xffffff; offset += 1) {
    const color = `#${((start + offset) & 0xffffff).toString(16).padStart(6, '0')}`;
    if (!used.has(color)) return color;
  }
  throw new Error('No unused service color remains.');
}

/** Whether two consecutive legs actually join on the ground. Resolving them as
 *  a throwaway pattern reuses the one trimming-and-orienting implementation
 *  rather than repeating it; this runs on an explicit delete, not per frame. */
function legsMeet(ways: Way[], a: PatternLeg, b: PatternLeg): boolean {
  const segs = patternSegments(wayById(ways), { id: 'probe', sections: oneSection([a, b]) });
  if (segs.length < 2) return false;
  const end = segs[0].path[segs[0].path.length - 1];
  const start = segs[1].path[0];
  return haversineMeters(end, start) <= JOIN_REUSE_TOLERANCE_M;
}

function insertPointIntoWay(
  system: TransitSystem,
  wayId: string,
  index: number,
  coord: LngLat,
): TransitSystem {
  const next = updateWayPoints(system, wayId, (pts) => [
    ...pts.slice(0, index),
    coord,
    ...pts.slice(index),
  ]);
  return { ...next, nodes: shiftNodeRefsForInsert(next.nodes, wayId, index) };
}

/** A real control-point index at normalized position `t` along a way, splicing
 *  one in when no existing point is already there — what splitWay needs, since
 *  it cuts at a control point rather than at an arbitrary position. Returns
 *  null when `t` lands on a way end, where there is nothing to cut. */
function insertIndexAtT(
  system: TransitSystem,
  wayId: string,
  t: number,
): { system: TransitSystem; index: number } | null {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  if (path.length < 2) return null;
  const coord = pointAtT(path, t);
  const existing = way.points.findIndex((p) => haversineMeters(p, coord) < JOIN_REUSE_TOLERANCE_M);
  if (existing > 0 && existing < way.points.length - 1) return { system, index: existing };
  if (existing === 0 || existing === way.points.length - 1) return null;
  const ins = nearestInsertionPoint(way.points, coord);
  if (!ins || ins.index <= 0 || ins.index > way.points.length - 1) return null;
  return { system: insertPointIntoWay(system, wayId, ins.index, coord), index: ins.index };
}

// ---- sharing what is already there ----------------------------------------

/**
 * Rebind one pattern onto the infrastructure it already runs along.
 *
 * Where the pattern's own path tracks a compatible existing way, it stops
 * riding its own geometry and starts riding that way; where it covers ground
 * nothing is built on, it keeps (or mints) geometry of its own. Sketch ways
 * left carrying nothing are removed — but never one that was imported or
 * deliberately named, which is somebody's real infrastructure rather than a
 * by-product of drawing.
 *
 * Returns the updated system, or null when there was nothing to share: no
 * compatible neighbour, or a run that couldn't be realized. Callers treat null
 * as "leave it alone", never as an error.
 *
 * One implementation for two callers that want the same thing for different
 * reasons — a GTFS import collapsing ten routes down a boulevard onto one
 * boulevard, and a line drawn along a street that should ride the street.
 */
/** A hand-picked merge will reach this far and no further. Past it the two
 *  alignments are different places, whatever the person clicked. */
const MERGE_MAX_TOLERANCE_M = 60;

/** The widest gap between two ways along the stretch where they run together —
 *  what an explicit merge has to be able to bridge. Null when either way has
 *  no resolvable path. */
function maxSeparationM(a: Way, b: Way): number | null {
  const pathB = resolveWayPath(b);
  if (pathB.length < 2) return null;
  // Densified, because a straight way is two points and its endpoints project
  // onto the ends of the other one — sampling only those measures nothing.
  const pathA = densifyForMatching(resolveWayPath(a), CONFLATION_TOLERANCE_M);
  if (pathA.length < 2) return null;
  let worst = 0;
  for (const point of pathA) {
    const near = nearestOnPath(pathB, point);
    if (!near) continue;
    // Only where they overlap: an overhanging tail is not what is being fused,
    // and letting it set the tolerance would open the merge up to the world.
    if (near.t <= 0 || near.t >= 1) continue;
    if (near.distMeters > worst) worst = near.distMeters;
  }
  return worst;
}

function conflatePatternOntoExisting(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  /** Restricts what the pattern may be absorbed into. Undefined means anything
   *  compatible, which is what drawing and importing want. An explicit
   *  "fuse these two ways" wants only the ways the user picked, so that
   *  reaching for it near a third corridor doesn't quietly rope that in. */
  ontoWayIds?: Set<string>,
  /** Overrides the mode's own corridor tolerance. Only an EXPLICIT "these two
   *  are one corridor" passes this: the strict mode tolerance exists to stop
   *  automatic conflation from fusing a frontage road into a boulevard, and
   *  that caution is exactly wrong once a person has pointed at both and said
   *  they are the same street. Without it, the recovery for a duplicate would
   *  be judged by the same rule that created the duplicate, and do nothing. */
  toleranceOverrideM?: number,
): TransitSystem | null {
  let sys = system;
  const service = sys.services.find((sv) => sv.id === serviceId);
  const pattern = service?.patterns.find((p) => p.id === patternId);
  if (!service || !pattern) return null;
  const oldWayIds = [...new Set(patternWayIds(pattern))];
  const rawPath = patternPath(sys.ways, pattern);
  if (rawPath.length < 2) return null;
  const wayTypeId = sys.ways.find((w) => w.id === oldWayIds[0])?.typeId;
  if (!wayTypeId) return null;

  const modeSpec = mode(service.modeId);
  const toleranceM = toleranceOverrideM ?? modeSpec.corridorToleranceM ?? CONFLATION_TOLERANCE_M;
  // Hand-drawn geometry can be two points a kilometre apart, and the matcher
  // judges a segment only as a whole — so without this, a line that runs along
  // a street and then turns off matches nothing at all. Densifying costs
  // nothing on an imported shape, whose segments are already short.
  const path = densifyForMatching(rawPath, toleranceM);
  const allowed = new Set(modeSpec.wayTypeIds);
  const exclude = new Set(oldWayIds);
  const candidates = sys.ways.filter(
    (w) => allowed.has(w.typeId) && !exclude.has(w.id) && (!ontoWayIds || ontoWayIds.has(w.id)),
  );
  // How close counts as "along" is a fact about the mode, not a constant: a
  // train is on the track or it isn't, while a bus is somewhere in a
  // carriageway that is itself road-width. See Mode.corridorToleranceM.
  const runs = detectShapeRuns(path, candidates, { toleranceM });
  // Nothing matched anywhere — the line is on new ground and stays there.
  if (runs.length === 1 && 'fresh' in runs[0]) return null;

  const newLegs: PatternLeg[] = [];
  const minted = new Set<string>();
  for (const run of runs) {
    const mat = materializeShapeRun(sys, run, path, wayTypeId);
    if (!mat) return null;
    if ('fresh' in run) for (const leg of mat.legs) minted.add(leg.wayId);
    sys = mat.system;
    newLegs.push(...mat.legs);
  }
  if (newLegs.length === 0) return null;

  const newWayIds = new Set(newLegs.map((l) => l.wayId));

  sys = {
    ...sys,
    services: sys.services.map((sv) =>
      sv.id === serviceId
        ? {
            ...sv,
            patterns: sv.patterns.map((p) =>
              p.id === patternId ? { ...p, sections: oneSection(newLegs) } : p,
            ),
          }
        : sv,
    ),
  };

  // Where the line leaves the corridor and returns to its own alignment, the
  // two legs meet at points a few metres apart — the corridor's centreline is
  // not where the line was drawn. That is a route with a hole in it, which
  // validateSystem reports and a rider could not travel. Close it by moving
  // the FRESHLY MINTED end onto the shared one; existing infrastructure is
  // never dragged to fit a line that joined it.
  sys = stitchFreshLegEnds(sys, serviceId, patternId, minted);

  for (const oldId of oldWayIds) {
    if (newWayIds.has(oldId)) continue;
    const way = sys.ways.find((w) => w.id === oldId);
    if (!way || way.source) continue; // imported infrastructure is not a by-product
    if (sys.namedWays.some((n) => n.wayIds.includes(oldId))) continue; // somebody named it
    const stillRidden = sys.services.some((sv) =>
      sv.patterns.some((p) => patternLegs(p).some((l) => l.wayId === oldId)),
    );
    if (!stillRidden) sys = removeWay(sys, oldId);
  }
  return sys;
}

/**
 * Pull newly minted geometry onto the corridor it hands over to.
 *
 * Conflation leaves a seam wherever a line steps between its own alignment and
 * a shared one, because those alignments are a few metres apart — that is what
 * made them different ways in the first place. Only ways minted by this same
 * pass are moved: a street somebody else drew does not get bent to meet a line
 * that just joined it.
 */
function stitchFreshLegEnds(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
  minted: Set<string>,
): TransitSystem {
  if (minted.size === 0) return system;
  let sys = system;
  for (let guard = 0; guard < minted.size + 1; guard++) {
    const service = sys.services.find((sv) => sv.id === serviceId);
    const pattern = service?.patterns.find((p) => p.id === patternId);
    if (!pattern) return sys;
    const segments = patternSegments(wayById(sys.ways), pattern);
    let moved = false;
    for (let i = 1; i < segments.length && !moved; i++) {
      const prev = segments[i - 1];
      const next = segments[i];
      const prevEnd = prev.path[prev.path.length - 1];
      const nextStart = next.path[0];
      if (haversineMeters(prevEnd, nextStart) <= JOIN_REUSE_TOLERANCE_M) continue;
      // Move whichever side this pass created; prefer the later one, so a run
      // of fresh legs walks forward onto the corridor rather than backward.
      const target = minted.has(next.leg.wayId)
        ? { wayId: next.leg.wayId, forward: next.forward, toStart: true, coord: prevEnd }
        : minted.has(prev.leg.wayId)
          ? { wayId: prev.leg.wayId, forward: prev.forward, toStart: false, coord: nextStart }
          : null;
      if (!target) continue;
      sys = updateWayPoints(sys, target.wayId, (pts) => {
        const atFirst = target.toStart === target.forward;
        const next = [...pts];
        next[atFirst ? 0 : next.length - 1] = target.coord;
        return next;
      });
      moved = true;
    }
    if (!moved) return sys;
  }
  return sys;
}

// ---- routing over existing infrastructure ----------------------------------
// Materializing a route into legs lives in core (model/routeLegs.ts) — it is
// pure, and through-routing two lines needs the same conversion.

/** The map coordinate a span ends at, for a span whose end is a real control
 *  point rather than a fractional anchor. */
function coordAtSpanEnd(system: TransitSystem, span: RouteSpan): LngLat | null {
  const way = system.ways.find((w) => w.id === span.wayId);
  if (!way) return null;
  return way.points[span.toPoint] ?? null;
}

/**
 * Where `coord` falls on a leg list, as the leg it lands on and the position
 * along that leg's WAY.
 *
 * This is the measurement patternEdits deliberately does not take: its
 * arithmetic is geometry-free and the store supplies the one number each
 * operation needs. Splitting a line into a couplet needs it because the point
 * the return path rejoins at is a coordinate, and turning that into "which leg,
 * how far along" is a projection.
 */
function cutIndexOnLegs(
  ways: Way[],
  legs: PatternLeg[],
  coord: LngLat,
  maxDistM = Infinity,
): { legIndex: number; t: number } | null {
  let bestIndex = -1;
  let bestT = 0;
  let bestDist = Infinity;
  legs.forEach((leg, legIndex) => {
    const way = ways.find((w) => w.id === leg.wayId);
    if (!way) return;
    const path = resolveWayPath(way);
    if (path.length < 2) return;
    const near = nearestOnPath(path, coord);
    if (!near || near.distMeters >= bestDist) return;
    bestIndex = legIndex;
    bestT = near.t;
    bestDist = near.distMeters;
  });
  return bestIndex >= 0 && bestDist <= maxDistM ? { legIndex: bestIndex, t: bestT } : null;
}

/** A section's legs, whichever kind it is — for the questions that do not care
 *  which direction rides them. */
function sectionLegs(section: PatternSection): PatternLeg[] {
  return section.kind === 'split' ? [...section.outbound, ...section.inbound] : section.legs;
}

/** The map coordinate at position `t` along a way. */
function coordOnWay(ways: Way[], wayId: string, t: number): LngLat | null {
  const way = ways.find((w) => w.id === wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  return path.length >= 2 ? pointAtT(path, t) : null;
}

/** One section cut back to `t` on `wayId`, dropping what lies beyond it in
 *  ride order. Returns null when the cut cannot be placed. */
function trimSection(
  ways: Way[],
  section: PatternSection,
  wayId: string,
  t: number,
  side: 'start' | 'end',
): PatternSection | null {
  const cutOne = (legs: PatternLeg[], at: { legIndex: number; t: number }, sd: 'start' | 'end') =>
    truncateLegs(legs, at.legIndex, at.t, sd);
  const indexIn = (legs: PatternLeg[]) => {
    const matching = legs.flatMap((l, i) => (l.wayId === wayId ? [i] : []));
    const legIndex = (side === 'start' ? matching[0] : matching[matching.length - 1]) ?? -1;
    return legIndex < 0 ? null : { legIndex, t };
  };

  if (section.kind !== 'split') {
    const at = indexIn(section.legs);
    return at ? { ...section, legs: cutOne(section.legs, at, side) } : null;
  }

  const outAt = indexIn(section.outbound);
  if (!outAt) return null;
  const outbound = cutOne(section.outbound, outAt, side);
  // The return trip is a different street, so the same cut has to be FOUND on
  // it rather than computed from the outward one — a projection, which is why
  // patternEdits cannot do this and the store must.
  //
  // And it cuts the other end: the outward trip's far terminus is the return
  // trip's first stop, so trimming the end of one trims the start of the other.
  const coord = coordOnWay(ways, wayId, t);
  // No distance cap here, unlike the rejoin test in attachReturnPath. That one
  // decides WHETHER an unrelated stroke belongs to this line, so a far match
  // means "no". These two halves are already known to be one pattern, so the
  // only question is WHERE the matching point is — and the nearest point on
  // the return path is that point however wide the couplet happens to be.
  const inAt = coord ? cutIndexOnLegs(ways, section.inbound, coord) : null;
  // Only a return with no resolvable legs at all gets here. Shortening one
  // direction and not the other would leave a line no vehicle can run.
  if (!inAt) return null;
  const inbound = cutOne(section.inbound, inAt, side === 'end' ? 'start' : 'end');
  return { kind: 'split', outbound, inbound };
}

/** A pattern's sections cut back so the line begins — or ends — at `t` on
 *  `wayId`. Null when the cut names a way the pattern does not ride. */
function trimSectionsTo(
  ways: Way[],
  sections: PatternSection[],
  wayId: string,
  t: number,
  side: 'start' | 'end',
): PatternSection[] | null {
  const holds = (sec: PatternSection) => sectionLegs(sec).some((l) => l.wayId === wayId);
  let idx = -1;
  if (side === 'start') idx = sections.findIndex(holds);
  else
    for (let i = sections.length - 1; i >= 0; i--)
      if (holds(sections[i])) {
        idx = i;
        break;
      }
  if (idx < 0) return null;
  const cut = trimSection(ways, sections[idx], wayId, t, side);
  if (!cut) return null;
  const kept = side === 'start' ? sections.slice(idx + 1) : sections.slice(0, idx);
  return pruneSections(side === 'start' ? [cut, ...kept] : [...kept, cut]);
}

/**
 * How far from the outward trip a return path may end and still count as
 * rejoining it.
 *
 * A block or two. The planner stops drawing on the RETURN street, which is a
 * street away from the outward one by definition, and often one corner short
 * of where the two actually merge — so this cannot be tight.
 *
 * It cannot be loose either, and that is the more dangerous direction. The
 * rejoin point decides how much of the line becomes a couplet: everything from
 * there to the terminus. Accepting a far-away match would silently split a
 * line end to end when someone drew one block of it. Beyond this, the draw is
 * refused outright rather than guessed at — see attachReturnPath.
 */
const RETURN_REJOIN_SNAP_M = 600;

/**
 * Realize one detected corridor-conflation run (see
 * model/geo/corridorConflation.ts's detectShapeRuns) as pattern legs. An
 * `OnWayRun`'s two anchors land on the SAME existing way — routeBetween's
 * dedicated same-way fast path (a direct arc-length slice, no Dijkstra/bias) —
 * and materializeRouteSpans turns that into one leg covering just that
 * stretch, leaving the way alone. A `FreshRun` mints a new way over the
 * sub-range instead, matching gtfsImport.ts's own one-way carriageway
 * construction — a small, deliberate duplication that keeps gtfsImport.ts's
 * pure, tested transform untouched — so this one still returns a system.
 */
function materializeShapeRun(
  system: TransitSystem,
  run: ShapeRun,
  path: LngLat[],
  wayTypeId: string,
): { system: TransitSystem; legs: PatternLeg[] } | null {
  const startCoord = path[run.fromIdx];
  const endCoord = path[run.toIdx];
  if (!startCoord || !endCoord) return null;
  if ('fresh' in run) {
    // Straight back down to the corners actually drawn: the path handed in may
    // have been subdivided for matching, and that is no reason for a two-click
    // line to come back with fifty drag handles.
    const points = dropCollinearPoints(path.slice(run.fromIdx, run.toIdx + 1));
    if (points.length < 2) return null;
    const wayId = shortId();
    const way: Way = {
      id: wayId,
      typeId: wayTypeId,
      points,
      geometry: 'straight',
      grade: 'atGrade',
      profile: makeOneWay(
        defaultProfileFor(wayTypeId, wayType(wayTypeId).importedCapacity),
        'forward',
      ),
    };
    return {
      system: { ...system, ways: [...system.ways, way] },
      legs: [wholeLeg(wayId)],
    };
  }
  const way = system.ways.find((w) => w.id === run.onWayId);
  if (!way) return null;
  const from = anchorOnWay(way, startCoord);
  const to = anchorOnWay(way, endCoord);
  if (!from || !to) return null;
  // 'legal' rather than 'preferLegal': an imported shape already knows which
  // direction it runs, and the way under it was minted one-way in that
  // direction. A run that cannot route legally is a conflation miss, and
  // falling through to fresh geometry beats binding it to a wrong-way leg.
  const res = routeBetween(system, from, to, {
    allowedTypeIds: new Set([way.typeId]),
    travel: 'legal',
  });
  if (!res) return null;
  const legs = materializeRouteSpans(system, res.spans);
  return legs ? { system, legs } : null;
}

export interface ReconcileImportedSystemResult {
  system: TransitSystem;
  reconciled: number;
}

/** Pure import reconciliation. Kept outside the Zustand action so the GTFS
 * pipeline can run it in a short-lived Worker and apply the result only if the
 * editor snapshot it started from is still current. */
export function reconcileImportedSystem(
  system: TransitSystem,
  serviceIds: string[],
): ReconcileImportedSystemResult {
  let next = system;
  const targets: { serviceId: string; patternId: string; length: number }[] = [];
  for (const serviceId of serviceIds) {
    const service = next.services.find((candidate) => candidate.id === serviceId);
    if (!service) continue;
    for (const pattern of service.patterns) {
      targets.push({
        serviceId,
        patternId: pattern.id,
        length: pathLengthMeters(patternPath(next.ways, pattern)),
      });
    }
  }
  targets.sort((a, b) => b.length - a.length);

  const established = new Set<string>();
  let reconciled = 0;
  for (const target of targets) {
    const reconciledSystem = conflatePatternOntoExisting(
      next,
      target.serviceId,
      target.patternId,
      established,
    );
    if (reconciledSystem) {
      next = reconciledSystem;
      reconciled++;
    }
    const service = next.services.find((candidate) => candidate.id === target.serviceId);
    const pattern = service?.patterns.find((candidate) => candidate.id === target.patternId);
    for (const leg of pattern ? patternLegs(pattern) : []) established.add(leg.wayId);
  }

  return { system: next, reconciled };
}

/**
 * Translates a whole multi-select group by a fixed lng/lat delta — "nudge
 * this whole line" without redrawing it point by point. A selected way's
 * points all shift together (and any station anchored to it follows for
 * free via updateWayPoints' own reanchorStations call); a selected station
 * or facility shifts directly UNLESS its anchor way is also in this same
 * group (already covered by the way's own shift, so shifting it again would
 * double the movement).
 */
function nudgeSelection(
  system: TransitSystem,
  items: MultiSelectItem[],
  dx: number,
  dy: number,
): TransitSystem {
  // A selected SERVICE contributes nothing here on purpose: a line has no
  // geometry of its own to move, and dragging one would have to move the
  // street under it — which also carries every other line on that street.
  // Whoever wants that selects the way.
  const wayIds = new Set(items.filter((i) => i.kind === 'way').map((i) => i.id));
  let next = updateWayPointsBatch(system, wayIds, (pts) =>
    pts.map((p): LngLat => [p[0] + dx, p[1] + dy]),
  );

  const stationIds = new Set(items.filter((i) => i.kind === 'station').map((i) => i.id));
  if (stationIds.size > 0) {
    next = {
      ...next,
      stations: next.stations.map((st) => {
        if (!stationIds.has(st.id) || st.anchors.some((a) => wayIds.has(a.wayId))) return st;
        return { ...st, coord: [st.coord[0] + dx, st.coord[1] + dy] };
      }),
    };
  }

  const facilityIds = new Set(items.filter((i) => i.kind === 'facility').map((i) => i.id));
  if (facilityIds.size > 0) {
    next = {
      ...next,
      facilities: next.facilities.map((f) => {
        if (!facilityIds.has(f.id)) return f;
        const geometry: LngLat | LngLat[] = Array.isArray(f.geometry[0])
          ? (f.geometry as LngLat[]).map((p): LngLat => [p[0] + dx, p[1] + dy])
          : ([(f.geometry as LngLat)[0] + dx, (f.geometry as LngLat)[1] + dy] as LngLat);
        return { ...f, geometry };
      }),
    };
  }

  return { ...next, updatedAt: Date.now() };
}

// Adopt-existing-infrastructure tuning: how far a sketch endpoint may sit
// from real infrastructure and still bind to it; how strongly the route is
// pulled toward the sketched corridor; how far a station may hop onto the
// adopted ways.
const ADOPT_SNAP_M = 500;
const ADOPT_BIAS_WEIGHT = 2;
const ADOPT_STATION_REANCHOR_M = 300;

const HISTORY_LIMIT = 100;

export function createEditorStore() {
  let nextLineNumber = 1;

  // Undo history. Kept out of reactive state (only canUndo/canRedo booleans
  // are) since these can hold many TransitSystem references — structural
  // sharing from the existing immutable-update pattern keeps that cheap, but
  // there's no reason to run it through Zustand's equality/subscriber machinery.
  let past: TransitSystem[] = [];
  let future: TransitSystem[] = [];
  // True while a `system` change shouldn't be recorded as an undo step:
  // setSystem/newSystem/undo/redo applying their own swap, and setViewport
  // (camera pan/zoom is persisted on the system for sharing, but it's not
  // content — it shouldn't be undo-able, or every pan would bury real edits
  // under viewport noise in the history stack).
  let skipHistory = false;
  // Non-null while a pointer gesture is in progress (see beginHistoryCheckpoint):
  // the system snapshot from right before it started, pushed as ONE history
  // entry when the gesture ends, instead of once per intermediate set() call.
  let checkpointBefore: TransitSystem | null = null;
  // How many begin/commit pairs are currently open. Only the OUTERMOST pair
  // records anything, so checkpoints nest instead of fighting.
  //
  // Needed because the natural way to make a composite action one undo step is
  // to bracket it — but a composite action can also be invoked from inside a
  // pointer gesture that already has a checkpoint open. Without a depth count
  // the inner commit closed the OUTER gesture's checkpoint, and every
  // subsequent frame of that gesture recorded its own history entry, which is
  // the per-frame history flooding checkpoints exist to prevent.
  let checkpointDepth = 0;

  function resetHistory() {
    past = [];
    future = [];
    // Loading a different system while a checkpoint is open (an import landing
    // mid-gesture, say) would otherwise leave the depth stranded above zero,
    // and every later commit would decrement toward a checkpoint that belongs
    // to a document no longer loaded — silently suppressing undo from then on.
    checkpointBefore = null;
    checkpointDepth = 0;
  }

  const editor = createStore<EditorState>()((set, get) => ({
    system: createEmptySystem(),
    tool: 'select',
    selectVariant: 'select',
    selection: null,
    activePatternId: null,
    armedTerminus: null,
    cameraFocusToken: 0,
    focusNameToken: 0,
    focusNameStationId: null,
    multiSelection: [],
    activeWayId: null,
    draftSeparate: false,
    draftWayTypeId: INITIAL_DRAFT.wayTypeId,
    draftModeId: INITIAL_DRAFT.modeId,
    draftGeometry: INITIAL_DRAFT.geometry,
    draftColor: modeRender(INITIAL_DRAFT.modeId).color,
    draftGrade: INITIAL_DRAFT.grade,
    draftClassId: wayType(INITIAL_DRAFT.wayTypeId).defaultClassId,
    draftPresetId: null,
    draftServiceEnabled: true,
    routeDraft: null,
    draftOneWay: false,
    draftFacilityTypeId: 'entrance',
    draftFacilityComplexMode: false,
    placingFacilityForGroupId: null,
    pickingMemberForGroupId: null,
    addingPatternForServiceId: null,
    readOnly: false,
    canUndo: false,
    canRedo: false,

    setSystem: (system, opts) => {
      skipHistory = true;
      set({
        system,
        readOnly: opts?.readOnly === true,
        selection: null,
        activePatternId: null,
        armedTerminus: null,
        multiSelection: [],
        activeWayId: null,
        tool: 'select',
      });
      skipHistory = false;
      resetHistory();
      set({ canUndo: false, canRedo: false });
    },

    undo: () => {
      if (past.length === 0) return;
      const prev = past.pop()!;
      future.push(get().system);
      // Undoing one node of an in-progress way should keep drawing that same
      // way, not exit draw mode — only clear activeWayId once the reverted
      // system no longer contains the way at all (undone past its creation).
      const { activeWayId } = get();
      const wayStillExists = activeWayId !== null && prev.ways.some((w) => w.id === activeWayId);
      skipHistory = true;
      set({
        system: prev,
        selection: null,
        armedTerminus: null,
        multiSelection: [],
        activeWayId: wayStillExists ? activeWayId : null,
        canUndo: past.length > 0,
        canRedo: true,
      });
      skipHistory = false;
    },

    redo: () => {
      if (future.length === 0) return;
      const next = future.pop()!;
      past.push(get().system);
      const { activeWayId } = get();
      const wayStillExists = activeWayId !== null && next.ways.some((w) => w.id === activeWayId);
      skipHistory = true;
      set({
        system: next,
        selection: null,
        armedTerminus: null,
        multiSelection: [],
        activeWayId: wayStillExists ? activeWayId : null,
        canUndo: true,
        canRedo: future.length > 0,
      });
      skipHistory = false;
    },

    beginHistoryCheckpoint: () => {
      checkpointDepth++;
      if (checkpointDepth > 1) return; // nested — rides the outermost snapshot
      checkpointBefore = get().system;
    },

    commitHistoryCheckpoint: () => {
      if (checkpointDepth === 0) return; // commit with no matching begin
      checkpointDepth--;
      if (checkpointDepth > 0) return; // still inside an outer checkpoint
      const before = checkpointBefore;
      checkpointBefore = null;
      if (before === null) return;
      const after = get().system;
      if (after === before) return; // e.g. a click that never moved anything
      past.push(before);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
      set({ canUndo: true, canRedo: false });
    },

    cancelHistoryCheckpoint: () => {
      if (checkpointDepth === 0) return;
      const before = checkpointBefore;
      checkpointBefore = null;
      checkpointDepth = 0;
      if (before === null || get().system === before) return;
      // Restore the exact immutable snapshot. Replaying inverse actions would
      // allocate new RTC-sized collections and force commit to deep-compare
      // them; this is O(1), produces no phantom undo step, and preserves every
      // field (including updatedAt) exactly as it was before the gesture.
      skipHistory = true;
      set({ system: before, armedTerminus: null });
      skipHistory = false;
    },

    newSystem: () => {
      skipHistory = true;
      set({
        system: createEmptySystem(),
        readOnly: false,
        selection: null,
        multiSelection: [],
        activeWayId: null,
        armedTerminus: null,
        tool: 'way',
      });
      skipHistory = false;
      resetHistory();
      set({ canUndo: false, canRedo: false });
    },

    setName: (name) => set((s) => ({ system: touch({ ...s.system, name }) })),
    // Sets the PERSISTED (saved) camera on the document. NOT the live-move path:
    // interactive pan/zoom goes through camera/liveCamera.ts, which deliberately
    // does NOT touch `system` (a fresh system reference on every drag frame was
    // the dominant RTC-scale pan cost — full buildFeatures rebuild + 13 setData +
    // autosave). Do NOT wire this to the map's moveend. skipHistory: a camera
    // change is never an undo step (see the skipHistory comment above).
    setViewport: (viewport) => {
      skipHistory = true;
      set((s) => ({ system: { ...s.system, viewport } }));
      skipHistory = false;
    },

    setTool: (tool) => {
      get().finishWay();
      set((s) => {
        // The Lines tool selects services and nothing else, so carrying an
        // infrastructure selection into it produces a mixed group that no
        // action applies to — a marquee only ever ADDS, so those ways would
        // sit there until cleared by hand. Switching tools is the moment to
        // drop them.
        if (tool !== 'lines' || s.tool === 'lines') return { tool, armedTerminus: null };
        return {
          tool,
          armedTerminus: null,
          multiSelection: s.multiSelection.filter((i) => i.kind === 'service'),
          selection: s.selection?.kind === 'service' ? s.selection : null,
        };
      });
    },

    // Not routed through history: a variant decides what the NEXT press does,
    // so undoing back through it would restore a mode rather than a change to
    // the system, and the edit it qualified would be a step further away.
    setSelectVariant: (variant) => set({ selectVariant: variant }),

    select: (selection) =>
      set((s) => ({
        selection,
        multiSelection: [],
        activePatternId:
          selection?.kind === 'service'
            ? (s.system.services.find((service) => service.id === selection.id)?.patterns[0]?.id ??
              null)
            : null,
      })),

    setActivePattern: (activePatternId) => set({ activePatternId }),
    armTerminus: (armedTerminus) =>
      set({ activePatternId: armedTerminus.patternId, armedTerminus }),
    clearArmedTerminus: () => set({ armedTerminus: null }),

    selectAndFocus: (selection) =>
      set((s) => ({
        selection,
        multiSelection: [],
        activePatternId:
          selection?.kind === 'service'
            ? (s.system.services.find((service) => service.id === selection.id)?.patterns[0]?.id ??
              null)
            : null,
        cameraFocusToken: s.cameraFocusToken + 1,
      })),

    toggleMultiSelect: (item) =>
      set((s) => {
        const exists = s.multiSelection.some((i) => i.kind === item.kind && i.id === item.id);
        const multiSelection = exists
          ? s.multiSelection.filter((i) => !(i.kind === item.kind && i.id === item.id))
          : [...s.multiSelection, item];
        return { multiSelection, selection: null };
      }),

    extendSelection: (item) =>
      set((s) => {
        const exists = s.multiSelection.some((i) => i.kind === item.kind && i.id === item.id);
        if (exists) {
          return {
            multiSelection: s.multiSelection.filter(
              (i) => !(i.kind === item.kind && i.id === item.id),
            ),
            selection: null,
          };
        }
        // Starting a group absorbs whatever was singly selected, so "click one
        // line, shift-click a second" ends up with both. Without it the first
        // click is thrown away, the group reads "1 selected", and no pairwise
        // action is reachable in two clicks.
        //
        // This is why it is a separate action from toggleMultiSelect rather
        // than a change to it: creating anything selects it, so a plain toggle
        // that absorbed the selection would sweep a just-placed station into
        // the next group nobody meant it to join.
        const selected = s.selection;
        const seed: MultiSelectItem[] =
          s.multiSelection.length === 0 &&
          selected &&
          selected.kind !== 'node' &&
          selected.kind !== 'group' &&
          !(selected.kind === item.kind && selected.id === item.id)
            ? [{ kind: selected.kind, id: selected.id }]
            : [];
        return { multiSelection: [...seed, ...s.multiSelection, item], selection: null };
      }),

    addMultiSelection: (items) =>
      set((s) => {
        const has = (item: MultiSelectItem) =>
          s.multiSelection.some((i) => i.kind === item.kind && i.id === item.id);
        const additions = items.filter((item) => !has(item));
        return additions.length === 0
          ? {}
          : { multiSelection: [...s.multiSelection, ...additions], selection: null };
      }),
    clearMultiSelection: () => set({ multiSelection: [] }),
    deleteMultiSelection: () =>
      set((s) => {
        let system = s.system;
        for (const item of s.multiSelection) {
          if (item.kind === 'way') system = removeWay(system, item.id);
          else if (item.kind === 'station')
            system = { ...system, stations: system.stations.filter((st) => st.id !== item.id) };
          else if (item.kind === 'facility')
            system = { ...system, facilities: system.facilities.filter((f) => f.id !== item.id) };
          else
            // Deleting a selected LINE takes the service and leaves the street
            // it rode standing — the infrastructure is selectable in its own
            // right, and nobody deleting a bus route means to demolish a road.
            system = { ...system, services: system.services.filter((sv) => sv.id !== item.id) };
        }
        return { system: touch(system), multiSelection: [] };
      }),
    nudgeMultiSelection: (dx, dy) =>
      set((s) => ({ system: nudgeSelection(s.system, s.multiSelection, dx, dy) })),

    setDraftSeparate: (separate) => set({ draftSeparate: separate }),

    setDraftWayType: (typeId) =>
      set((s) => {
        const compatible = modesForWayType(typeId);
        const modeId = compatible.some((m) => m.id === s.draftModeId)
          ? s.draftModeId
          : (compatible[0]?.id ?? s.draftModeId);
        return {
          draftWayTypeId: typeId,
          draftModeId: modeId,
          draftColor: modeRender(modeId).color,
          draftClassId: wayType(typeId).defaultClassId,
          draftPresetId: null,
        };
      }),
    // Symmetric to setDraftWayType: picking a mode (the "Line type" picker in
    // Network view — see Toolbar.tsx) picks a compatible way type too,
    // keeping the current one if it's still valid (e.g. switching between
    // lightRail and tram while staying on a road alignment) and otherwise
    // falling back to the mode's own preferred/default carrier. Without this
    // a mode-first pick would leave a stale, possibly-incompatible way type
    // behind for beginWay to silently resolve some other way.
    setDraftMode: (modeId) =>
      set((s) => {
        const m = mode(modeId);
        const wayTypeId = m.wayTypeIds.includes(s.draftWayTypeId)
          ? s.draftWayTypeId
          : (m.wayTypeIds[0] ?? s.draftWayTypeId);
        return {
          draftModeId: modeId,
          draftWayTypeId: wayTypeId,
          draftColor: modeRender(modeId).color,
          draftClassId: wayType(wayTypeId).defaultClassId,
          // Explicitly picking a mode means "draw a line" — always re-enables
          // service creation, whatever the bare-infrastructure toggle said.
          draftServiceEnabled: true,
        };
      }),
    setDraftGeometry: (geometry) => set({ draftGeometry: geometry }),
    setDraftColor: (color) => set({ draftColor: color }),
    setDraftGrade: (grade) => set({ draftGrade: grade }),
    setDraftClassId: (classId) => set({ draftClassId: classId }),
    // A preset also carries a facility class; picking it keeps them in sync.
    setDraftPreset: (presetId) => {
      const preset = presetId ? PROFILE_PRESETS[presetId] : undefined;
      set((s) => ({
        draftPresetId: preset ? presetId : null,
        draftClassId: preset?.classId ?? s.draftClassId,
      }));
    },
    setDraftServiceEnabled: (enabled) => set({ draftServiceEnabled: enabled }),
    setDraftOneWay: (on) => set({ draftOneWay: on }),
    setDraftFacilityType: (typeId) =>
      set({ draftFacilityTypeId: typeId, draftFacilityComplexMode: false }),
    setDraftFacilityComplexMode: (on) => set({ draftFacilityComplexMode: on }),

    addPaletteColor: (color) =>
      set((s) =>
        s.system.palette.includes(color)
          ? s
          : { system: touch({ ...s.system, palette: [...s.system.palette, color] }) },
      ),

    beginWay: (typeId, geometry, color) => {
      const st = get();
      const resolvedTypeId = typeId ?? st.draftWayTypeId;
      const resolvedGeometry = geometry ?? st.draftGeometry;
      const wayId = shortId();
      // The draft class only applies as-is when it belongs to the resolved type
      // (the normal case: the Way tool keeps them in sync via setDraftWayType).
      // A caller passing an explicit typeId that diverges from the current draft
      // falls back to that type's own default class, never a stale one.
      const classId =
        resolvedTypeId === st.draftWayTypeId
          ? st.draftClassId
          : wayType(resolvedTypeId).defaultClassId;
      // The armed draft preset ("4-lane arterial", …) shapes the new way's
      // cross-section when it belongs to the resolved type; otherwise the
      // type's own default profile applies.
      const preset = st.draftPresetId ? PROFILE_PRESETS[st.draftPresetId] : undefined;
      const presetApplies = preset && preset.wayTypeId === resolvedTypeId;
      // The armed Direction toggle: one-way ways travel the direction
      // they're drawn in (flip later with D).
      const baseProfile = buildProfile(
        presetApplies ? preset.lanes : wayType(resolvedTypeId).defaultProfile,
      );
      const way: Way = {
        id: wayId,
        typeId: resolvedTypeId,
        points: [],
        geometry: resolvedGeometry,
        grade: st.draftGrade,
        profile: st.draftOneWay ? makeOneWay(baseProfile, 'forward') : baseProfile,
        classId: presetApplies && preset.classId ? preset.classId : classId,
      };
      const modeId = modesForWayType(resolvedTypeId).some((m) => m.id === st.draftModeId)
        ? st.draftModeId
        : modesForWayType(resolvedTypeId)[0]?.id;
      // While "add branch" is armed, this way becomes a new PATTERN on the
      // target service once drawing finishes (see finishWay) instead of
      // spawning its own separate service.
      const addingBranch = !!st.addingPatternForServiceId;
      const service: Service | null =
        modeId && !addingBranch && st.draftServiceEnabled
          ? {
              id: shortId(),
              name: `Line ${nextLineNumber++}`,
              modeId,
              color: color ?? st.draftColor,
              patterns: [{ id: shortId(), sections: oneSection([wholeLeg(wayId)]) }],
              frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
              spanStart: DEFAULT_SPAN_START,
              spanEnd: DEFAULT_SPAN_END,
            }
          : null;
      set((s) => ({
        system: touch({
          ...s.system,
          ways: [...s.system.ways, way],
          services: service ? [...s.system.services, service] : s.system.services,
        }),
        activeWayId: wayId,
        selection: service
          ? { kind: 'service', id: service.id }
          : addingBranch
            ? s.selection
            : { kind: 'way', id: wayId },
      }));
      return wayId;
    },

    resumeWay: (id) => set({ activeWayId: id }),

    beginOneWayBranch: (fromWayId, end) => {
      const st = get();
      const src = st.system.ways.find((w) => w.id === fromWayId);
      if (!src || src.points.length < 2) return null;
      const branchPoint = end === 'start' ? src.points[0] : src.points[src.points.length - 1];
      const wayId = shortId();
      const way: Way = {
        id: wayId,
        typeId: src.typeId,
        points: [branchPoint],
        geometry: st.draftGeometry,
        grade: src.grade,
        // Continue the street's own cross-section, made one-way with travel
        // AWAY from the branch point (the direction it's about to be drawn).
        profile: makeOneWay(cloneProfile(src.profile), 'forward'),
        classId: src.classId,
      };
      set((s) => {
        let system: TransitSystem = { ...s.system, ways: [...s.system.ways, way] };
        // A real junction at the branch point.
        system = joinWayPointToWay(system, wayId, 0, fromWayId, branchPoint);
        // The branch continues the same street identity, if there is one.
        const identity = system.namedWays.find((n) => n.wayIds.includes(fromWayId));
        if (identity) {
          system = {
            ...system,
            namedWays: system.namedWays.map((n) =>
              n.id === identity.id ? { ...n, wayIds: [...n.wayIds, wayId] } : n,
            ),
          };
        }
        return {
          system: touch(system),
          activeWayId: wayId,
          selection: { kind: 'way', id: wayId },
          draftOneWay: true, // the Direction toggle arms so follow-up segments match
        };
      });
      return wayId;
    },

    addWayPoint: (wayId, coord) =>
      set((s) => ({ system: updateWayPoints(s.system, wayId, (pts) => [...pts, coord]) })),

    insertWayPoint: (wayId, index, coord) =>
      set((s) => ({
        system: {
          ...updateWayPoints(s.system, wayId, (pts) => [
            ...pts.slice(0, index),
            coord,
            ...pts.slice(index),
          ]),
          nodes: shiftNodeRefsForInsert(s.system.nodes, wayId, index),
        },
      })),

    moveWayPoint: (wayId, index, coord) =>
      set((s) => ({ system: cascadeMove(s.system, wayId, index, coord) })),

    deleteWayPoint: (wayId, index) =>
      set((s) => {
        // A way below 2 points can't render — same floor straightenWay
        // enforces. Without this, alt-drag erasing over every handle leaves a
        // ghost way sitting invisibly in the document until it round-trips
        // through save/load.
        const way = s.system.ways.find((w) => w.id === wayId);
        if (!way || way.points.length <= 2) return s;
        return {
          system: {
            ...updateWayPoints(s.system, wayId, (pts) => pts.filter((_, i) => i !== index)),
            nodes: shiftNodeRefsForDelete(s.system.nodes, wayId, index),
          },
        };
      }),

    joinWayPointToWay: (wayId, index, targetWayId, coord) =>
      set((s) => ({ system: joinWayPointToWay(s.system, wayId, index, targetWayId, coord) })),

    closeWayLoop: (wayId) => set((s) => ({ system: closeWayLoop(s.system, wayId) })),

    straightenWay: (wayId) => set((s) => ({ system: straightenWay(s.system, wayId) })),

    finishWay: () => {
      const { activeWayId, addingPatternForServiceId } = get();
      if (!activeWayId) return;
      const finishedWayId = activeWayId;
      set((s) => {
        const way = s.system.ways.find((w) => w.id === activeWayId);
        if (way && way.points.length < 2) {
          // The stub way (and its default service, if any) is discarded.
          return {
            activeWayId: null,
            addingPatternForServiceId: null,
            system: touch(removeWay(s.system, activeWayId)),
            selection: null,
          };
        }
        if (addingPatternForServiceId) {
          const services = s.system.services.map((sv) =>
            sv.id === addingPatternForServiceId
              ? {
                  ...sv,
                  patterns: [
                    ...sv.patterns,
                    { id: shortId(), sections: oneSection([wholeLeg(activeWayId)]) },
                  ],
                }
              : sv,
          );
          return {
            activeWayId: null,
            addingPatternForServiceId: null,
            system: touch({ ...s.system, services }),
            selection: { kind: 'service', id: addingPatternForServiceId },
          };
        }
        return { activeWayId: null };
      });
      // Share what's already there. A line drawn along an existing street is
      // expected to RIDE that street, not to lay a second one beside it — so
      // on commit, every stretch of the finished line that tracks compatible
      // infrastructure is rebound onto it, and only genuinely new ground keeps
      // geometry of its own.
      //
      // Run at commit rather than per node: conflation needs the whole stroke
      // to tell a real shared run from a coincidental crossing (see
      // detectShapeRuns' minRunM), and mutating infrastructure mid-gesture
      // would rebuild the snap grid on every point placed.
      //
      // `draftSeparate` (Alt) is the opt-out, for the express track beside the
      // local one and the busway beside the road.
      if (!get().draftSeparate) {
        for (const svc of get().system.services) {
          const pattern = svc.patterns.find((p) =>
            patternLegs(p).some((l) => l.wayId === finishedWayId),
          );
          if (!pattern) continue;
          const next = conflatePatternOntoExisting(get().system, svc.id, pattern.id);
          if (next) set({ system: touch(next) });
          break;
        }
      }
      // The SimCity moment, wired to every commit path (double-click, Enter,
      // tool switch): a newly finished way crossing same-grade ways forms
      // real junctions there. The stub-discard path above removed the way, and
      // conflation may have absorbed it into a way that already existed, so
      // the existence check makes this a no-op in both cases.
      if (get().system.ways.some((w) => w.id === finishedWayId)) {
        get().formCrossingJunctions(finishedWayId);
      }
      // Disarmed here rather than where the press set it: it has to survive
      // every node of the gesture, and the next line drawn shares by default
      // again unless its own first press asks otherwise.
      set({ draftSeparate: false });
    },

    setWayGeometry: (id, geometry) =>
      set((s) => {
        const withGeom = {
          ...s.system,
          ways: s.system.ways.map((w) => (w.id === id ? { ...w, geometry } : w)),
        };
        return {
          system: { ...withGeom, stations: reanchorStations(withGeom, id), updatedAt: Date.now() },
        };
      }),

    setWayGrade: (id, grade) =>
      set((s) => ({
        system: touch({
          ...s.system,
          ways: s.system.ways.map((w) => (w.id === id ? { ...w, grade } : w)),
        }),
      })),

    setWayClassId: (id, classId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          ways: s.system.ways.map((w) => (w.id === id ? { ...w, classId } : w)),
        }),
      })),

    // Capacity is derived from the cross-section, so stepping it adds or
    // removes primary travel lanes (drive/track) via profile.ts.
    setWayCapacity: (id, capacity) =>
      set((s) => ({
        system: touch({
          ...s.system,
          ways: s.system.ways.map((w) =>
            w.id === id
              ? {
                  ...w,
                  profile: withLaneCount(w.profile, w.typeId, capacity, s.system.drivingSide),
                }
              : w,
          ),
        }),
      })),

    deleteWay: (id) =>
      set((s) => ({
        system: touch(removeWay(s.system, id)),
        selection: s.selection?.kind === 'way' && s.selection.id === id ? null : s.selection,
        activeWayId: s.activeWayId === id ? null : s.activeWayId,
      })),

    splitWayAt: (wayId, index) => set((s) => ({ system: splitWay(s.system, wayId, index) })),

    splitWayAtT: (wayId, t) =>
      set((s) => {
        const at = insertIndexAtT(s.system, wayId, t);
        return at ? { system: splitWay(at.system, wayId, at.index) } : {};
      }),

    // Safe to append without renumbering refs: every id is a fresh shortId()
    // and every ref points at a way created in this same import, so no
    // existing node's refs are disturbed (cf. shiftNodeRefsFor* above).
    importWays: (incoming) => {
      const state = get().system;
      const { network, duplicateWays, identityAdditions, junctionAdditions } =
        withoutAlreadyImported(incoming, state.ways, state.namedWays, state.nodes);
      const { ways, nodes, namedWays, medians, turnRestrictions } = network;
      const additionsById = new Map(identityAdditions.map((a) => [a.id, a.wayIds]));
      const armsById = new Map(junctionAdditions.map((a) => [a.id, a.refs]));
      set((s) => ({
        system: touch({
          ...s.system,
          ways: [...s.system.ways, ...ways],
          nodes: [
            // A junction this import also touches gains the new arm rather
            // than a second Node appearing at the same coordinate.
            ...s.system.nodes.map((n) => {
              const arms = armsById.get(n.id);
              return arms ? { ...n, refs: [...n.refs, ...arms] } : n;
            }),
            ...nodes,
          ],
          namedWays: [
            // A street continuing into this import joins the identity it
            // already has rather than gaining a second one.
            ...s.system.namedWays.map((n) => {
              const additions = additionsById.get(n.id);
              return additions ? { ...n, wayIds: [...n.wayIds, ...additions] } : n;
            }),
            ...namedWays,
          ],
          // A carriageway pair arrives with the median it is separated by, so
          // Combine restores the real gap rather than a generic default.
          medians: medians.reduce((acc, m) => withComponent(acc, m.id, m.median), s.system.medians),
          // Turn bans OSM records as relations. touch() prunes any whose lane
          // stops existing, so these can't outlive the profile they describe.
          turnRestrictions: turnRestrictions.reduce(
            (acc, t) => withComponent(acc, t.key, t.restriction),
            s.system.turnRestrictions,
          ),
        }),
      }));
      // Imported ways arrive with no crossing pass at all — a hand-drawn way
      // gets this at finishWay, so an import should form the same junctions
      // it would have if someone had drawn it.
      for (const way of ways) get().formCrossingJunctions(way.id);
      return { added: ways.length, skipped: duplicateWays };
    },

    importGtfs: (pieces) => {
      set((s) => ({
        system: touch({
          ...s.system,
          ways: [...s.system.ways, ...pieces.ways],
          services: [...s.system.services, ...pieces.services],
          stations: [...s.system.stations, ...pieces.stations],
        }),
      }));
      // Same crossing pass importWays gets — a GTFS feed's shapes cross real
      // streets constantly, and none of that geometry has been through
      // finishWay's own junction-forming.
      for (const way of pieces.ways) get().formCrossingJunctions(way.id);
    },

    applyGtfsImportBatch: ({ targetSystemId, pieces }) => {
      let applied = false;
      set((s) => {
        if (s.system.id !== targetSystemId) return s;
        applied = true;
        return {
          system: touch({
            ...s.system,
            ways: [...s.system.ways, ...pieces.ways],
            services: [...s.system.services, ...pieces.services],
            stations: [...s.system.stations, ...pieces.stations],
          }),
        };
      });
      if (applied) for (const way of pieces.ways) get().formCrossingJunctions(way.id);
      return applied;
    },

    setWayProfile: (id, profile) =>
      set((s) => {
        // Lanes that vanished from the profile take their junction connectors
        // with them.
        const way = s.system.ways.find((w) => w.id === id);
        if (!way) return s;
        const laneIds = new Set(profile.lanes.map((l) => l.id));
        const nodes = s.system.nodes.map((n) => {
          if (!n.connectors) return n;
          const connectors = n.connectors.filter(
            (c) =>
              (c.from.wayId !== id || laneIds.has(c.from.laneId)) &&
              (c.to.wayId !== id || laneIds.has(c.to.laneId)),
          );
          return connectors.length === n.connectors.length
            ? n
            : { ...n, connectors: connectors.length > 0 ? connectors : undefined };
        });
        return {
          system: touch({
            ...s.system,
            ways: s.system.ways.map((w) => (w.id === id ? { ...w, profile } : w)),
            nodes,
          }),
        };
      }),

    applyProfilePreset: (id, presetId) => {
      const preset = PROFILE_PRESETS[presetId];
      if (!preset) return;
      const profile = buildProfile(preset.lanes);
      const st = get();
      const way = st.system.ways.find((w) => w.id === id);
      if (!way) return;
      st.setWayProfile(id, profile);
      if (preset.classId) st.setWayClassId(id, preset.classId);
    },

    nameWay: (wayId, name) =>
      set((s) => {
        const trimmed = name.trim();
        const current = s.system.namedWays.find((n) => n.wayIds.includes(wayId));
        if (!trimmed) {
          if (!current) return s;
          return {
            system: touch({ ...s.system, namedWays: pruneNamedWays(s.system.namedWays, wayId) }),
          };
        }
        let namedWays: NamedWay[];
        if (current) {
          // Renaming through any member renames the shared identity — that's
          // the point of it being shared.
          namedWays = s.system.namedWays.map((n) =>
            n.id === current.id ? { ...n, name: trimmed } : n,
          );
        } else {
          const existing = s.system.namedWays.find((n) => n.name === trimmed);
          namedWays = existing
            ? s.system.namedWays.map((n) =>
                n.id === existing.id ? { ...n, wayIds: [...n.wayIds, wayId] } : n,
              )
            : [...s.system.namedWays, { id: shortId(), name: trimmed, wayIds: [wayId] }];
        }
        return { system: touch({ ...s.system, namedWays }) };
      }),

    renameNamedWay: (id, name) =>
      set((s) => ({
        system: touch({
          ...s.system,
          namedWays: s.system.namedWays.map((n) => (n.id === id ? { ...n, name: name.trim() } : n)),
        }),
      })),

    setNodeControl: (nodeId, control) =>
      set((s) => ({
        system: touch({
          ...s.system,
          nodes: s.system.nodes.map((n) => (n.id === nodeId ? { ...n, control } : n)),
        }),
      })),

    setNodeConnectors: (nodeId, connectors) =>
      set((s) => ({
        system: touch({
          ...s.system,
          nodes: s.system.nodes.map((n) => (n.id === nodeId ? { ...n, connectors } : n)),
        }),
      })),

    disconnectNodeWay: (nodeId, wayId) =>
      set((s) => {
        const system = disconnectWayFromNode(s.system, nodeId, wayId);
        const nodeSurvives = system.nodes.some((n) => n.id === nodeId);
        return {
          system,
          selection:
            !nodeSurvives && s.selection?.kind === 'node' && s.selection.id === nodeId
              ? null
              : s.selection,
        };
      }),

    setApproachControl: (wayId, end, control) =>
      set((s) => {
        const key = armRefKey(wayId, end);
        const approachControls = control
          ? withComponent(s.system.approachControls, key, { control })
          : withoutComponent(s.system.approachControls, key);
        return { system: touch({ ...s.system, approachControls }) };
      }),

    setTurnRestriction: (wayId, laneId, allowedTargets) =>
      set((s) => {
        const key = laneRefKey(wayId, laneId);
        const turnRestrictions = allowedTargets
          ? withComponent(s.system.turnRestrictions, key, { allowedTargets })
          : withoutComponent(s.system.turnRestrictions, key);
        return { system: touch({ ...s.system, turnRestrictions }) };
      }),

    setDrivingSide: (side) => set((s) => ({ system: touch({ ...s.system, drivingSide: side }) })),

    formCrossingJunctions: (wayId, onlyWithWayId) =>
      set((s) => ({ system: formCrossingJunctions(s.system, wayId, onlyWithWayId) })),

    mergeWays: (keepWayId, otherWayId) =>
      set((s) => ({
        system: mergeWays(s.system, keepWayId, otherWayId),
        selection:
          s.selection?.kind === 'way' && s.selection.id === otherWayId
            ? { kind: 'way', id: keepWayId }
            : s.selection,
      })),

    separateCarriageways: (wayId) => {
      const st = get();
      const way = st.system.ways.find((w) => w.id === wayId);
      if (!way || way.points.length < 2) return null;
      const drivingSide = st.system.drivingSide;
      const sep = separateProfiles(way.profile, drivingSide);
      if (!sep) return null;

      // Gap between the carriageways: the profile's own median if it had
      // one (captured below into the Median component so a later combine
      // can restore it), else the catalog default — measured center-to-
      // center below.
      const medianLane = way.profile.lanes.find((l) => laneKind(l.kindId).role === 'separator');
      const medianWidth = medianLane?.widthM ?? 0;
      const gap = Math.max(medianWidth, LANE_KINDS.median.defaultWidthM);
      const d = profileWidthM(sep.forward) / 2 + gap + profileWidthM(sep.backward) / 2;

      // The original way keeps its alignment (and every junction on it) and
      // becomes the forward carriageway; the backward carriageway is a new
      // way offset LEFT of travel under right-hand traffic (mirrored under
      // left-hand traffic). Both live under one identity.
      const newId = shortId();
      const backwardOffsetM = drivingSide === 'left' ? d : -d;
      const newWay: Way = {
        ...way,
        id: newId,
        points: offsetPolyline(way.points, backwardOffsetM),
        profile: sep.backward,
      };
      set((s) => {
        const ways = [
          ...s.system.ways.map((w) => (w.id === wayId ? { ...w, profile: sep.forward } : w)),
          newWay,
        ];
        const current = s.system.namedWays.find((n) => n.wayIds.includes(wayId));
        let namedWays: NamedWay[];
        let namedWayId: string;
        if (current) {
          namedWayId = current.id;
          namedWays = s.system.namedWays.map((n) =>
            n.id === current.id ? { ...n, wayIds: [...n.wayIds, newId] } : n,
          );
        } else {
          namedWayId = shortId();
          namedWays = [...s.system.namedWays, { id: namedWayId, name: '', wayIds: [wayId, newId] }];
        }
        const medians = withComponent(s.system.medians, namedWayId, {
          widthM: gap,
          kindId: medianLane?.kindId ?? 'median',
        });
        return { system: touch({ ...s.system, ways, namedWays, medians }) };
      });
      return newId;
    },

    combineCarriageways: (namedWayId) =>
      set((s) => {
        const nw = s.system.namedWays.find((n) => n.id === namedWayId);
        if (!nw || nw.wayIds.length !== 2) return s;
        const x = s.system.ways.find((w) => w.id === nw.wayIds[0]);
        const y = s.system.ways.find((w) => w.id === nw.wayIds[1]);
        if (!x || !y || x.typeId !== y.typeId || x.points.length < 2 || y.points.length < 2)
          return s;
        // combineProfiles assumes one one-way half per direction; joining two
        // two-way ways would produce a four-directional street. `<= 1` rather
        // than isOneWay so the zero-directional-lane half separateProfiles can
        // produce still round-trips. The inspector shows the same rule as a
        // disabled button — see WayInspector's canCombine.
        const oneDirectionOnly = (w: Way) =>
          new Set(directionalLanes(w.profile).map((l) => l.direction)).size <= 1;
        if (!oneDirectionOnly(x) || !oneDirectionOnly(y)) return s;

        // The forward carriageway's alignment survives as the combined
        // centerline (symmetric with separateCarriageways, which kept the
        // original alignment for the forward half).
        const runsForward = (w: Way) =>
          directionalLanes(w.profile).every((l) => l.direction === 'forward');
        const keeper = runsForward(x) ? x : runsForward(y) ? y : x;
        const other = keeper === x ? y : x;

        // The other carriageway's profile expressed in the keeper's frame:
        // flip it when it geometrically runs the opposite direction (two
        // independently drawn one-ways); keep it as-is when it came from
        // separateCarriageways (same point orientation, backward lanes).
        const sameDir =
          haversineMeters(keeper.points[0], other.points[0]) +
            haversineMeters(
              keeper.points[keeper.points.length - 1],
              other.points[other.points.length - 1],
            ) <=
          haversineMeters(keeper.points[0], other.points[other.points.length - 1]) +
            haversineMeters(keeper.points[keeper.points.length - 1], other.points[0]);
        const backHalf = sameDir ? other.profile : flipProfile(other.profile);
        const median = getComponent(s.system.medians, namedWayId);
        const combined = combineProfiles(
          backHalf,
          keeper.profile,
          median?.widthM,
          median?.kindId,
          s.system.drivingSide,
        );

        // Everything anchored to the discarded carriageway belongs to the
        // street, not to the half that happened to lose the coin flip.
        // removeWay deletes stations anchored to it and drops its junction
        // refs (severing whatever met it), so carry both across first — the
        // same rescue mergeWays performs when it collapses two ways into one.
        const keeperPath = resolveWayPath(keeper);
        const stations = s.system.stations.map((st) => {
          if (!anchorOnWayId(st, other.id)) return st;
          const on = nearestOnPath(keeperPath, st.coord);
          return on
            ? { ...st, anchors: reanchored(st, other.id, { wayId: keeper.id, t: on.t }) }
            : st;
        });

        // A carriageway pair from separateCarriageways is index-aligned
        // (offsetPolyline moves each point), so ref index k on `other` is
        // index k on the keeper. Two independently drawn one-ways need not
        // be, so fall back to the keeper's nearest control point.
        const nearestIndex = (coord: LngLat): number => {
          let best = 0;
          let bestD = Infinity;
          keeper.points.forEach((p, i) => {
            const d = haversineMeters(p, coord);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          return best;
        };
        const aligned = keeper.points.length === other.points.length;
        const mapIndex = (k: number): number => (aligned ? k : nearestIndex(other.points[k]));
        const nodes = s.system.nodes
          .map((n) => {
            const refs = n.refs.map((r) =>
              r.wayId === other.id ? { wayId: keeper.id, pointIndex: mapIndex(r.pointIndex) } : r,
            );
            const seen = new Set<string>();
            return {
              ...n,
              refs: refs.filter((r) =>
                seen.has(`${r.wayId}:${r.pointIndex}`)
                  ? false
                  : (seen.add(`${r.wayId}:${r.pointIndex}`), true),
              ),
            };
          })
          .filter((n) => n.refs.length >= 2);

        // Service legs need the same rescue as stations and nodes above, and
        // used to be the one thing that did not get it: removeWay PRUNES legs
        // naming the discarded carriageway, so combining a boulevard silently
        // deleted whichever direction of a line rode that half. On a one-way
        // couplet that is the entire return trip.
        //
        // mergeLegs already does the work — remap each extent onto the
        // keeper's parameterization and flip the direction when the two halves
        // ran opposite ways round — so this is the same remap it takes for two
        // ways fused end to end, with the projection done against the keeper.
        const otherPath = resolveWayPath(other);
        const rebindRemap = {
          positionOf: (wayId: string, t: number): number => {
            if (wayId !== other.id || otherPath.length < 2) return t;
            return nearestOnPath(keeperPath, pointAtT(otherPath, t))?.t ?? t;
          },
          reversed: (wayId: string): boolean => wayId === other.id && !sameDir,
        };
        const rebound = s.system.services.map((sv) => ({
          ...sv,
          patterns: sv.patterns.map((pt) => ({
            ...pt,
            // Then normalize: with both directions now on the keeper, a couplet
            // over this boulevard is a line running one two-way street, and
            // saying otherwise would draw one-way chevrons both ways along it.
            sections: normalizeSections(
              mapSectionLegs(pt.sections, (legs) =>
                mergeLegs(legs, keeper.id, other.id, rebindRemap),
              ),
            ),
          })),
        }));

        let system = removeWay({ ...s.system, stations, nodes, services: rebound }, other.id);
        system = {
          ...system,
          ways: system.ways.map((w) => (w.id === keeper.id ? { ...w, profile: combined } : w)),
        };
        return {
          system: touch(system),
          selection: { kind: 'way', id: keeper.id },
        };
      }),

    setMedianWidth: (namedWayId, widthM) =>
      set((s) => {
        const existing = getComponent(s.system.medians, namedWayId);
        const medians =
          widthM === undefined
            ? withoutComponent(s.system.medians, namedWayId)
            : withComponent(s.system.medians, namedWayId, {
                widthM,
                kindId: existing?.kindId ?? 'median',
              });
        return { system: touch({ ...s.system, medians }) };
      }),

    startRouteDraft: (anchor) => {
      const st = get();
      set({ routeDraft: { modeId: st.draftModeId, lastAnchor: anchor, spans: [] } });
    },

    extendRouteDraft: (anchor) => {
      const st = get();
      const rd = st.routeDraft;
      if (!rd) return false;
      const allowed = new Set(mode(rd.modeId).wayTypeIds);
      // 'preferLegal': a one-way street should push the route round the block,
      // but when nothing legal exists a bare refusal is indistinguishable from
      // a missed click. Give the planner the line and mark what is wrong with
      // it — the spans come back flagged `wrongWay`.
      const res = routeBetween(st.system, rd.lastAnchor, anchor, {
        allowedTypeIds: allowed,
        travel: 'preferLegal',
      });
      if (!res || res.spans.length === 0) return false;

      // Consecutive legs share their boundary anchor; when the new leg
      // continues straight through the same way, merge the seam into one
      // span. The draft then refuses any way it has already used.
      //
      // That refusal is blunter than routeGraph's, which now rejects only
      // spans that overlap in the same direction. Leaving it blunt for now:
      // relaxing it needs the draft to know which of a line's two directions
      // a span belongs to, and that arrives with the couplet gestures. Until
      // then a route that legitimately re-uses a way has to be drawn in two
      // strokes rather than being silently mis-joined.
      const spans = rd.spans.map((s) => ({ ...s }));
      let rest = res.spans;
      const last = spans[spans.length - 1];
      const first = res.spans[0];
      if (last && first.wayId === last.wayId) {
        // Two fractional spans inside one segment of one way join cleanly:
        // the result is still one fractional span, from the first's start to
        // the second's end. Any street drawn as a bare two-point line produces
        // these, so refusing them outright made a couplet undrawable on
        // exactly the streets people sketch first.
        if (last.noInterior && first.noInterior) {
          if (last.seg !== first.seg || !last.toCoord || !first.toCoord) return false;
          last.toCoord = first.toCoord;
          rest = res.spans.slice(1);
        } else if (last.noInterior || first.noInterior) {
          return false; // one fractional, one not: the seam direction is undefined
        } else {
          const dirPrev = Math.sign(last.toPoint - last.fromPoint);
          const dirNext = Math.sign(first.toPoint - first.fromPoint);
          if (last.toCoord && first.fromCoord && dirPrev === dirNext) {
            last.toPoint = first.toPoint;
            last.toCoord = first.toCoord;
            rest = res.spans.slice(1);
          } else {
            return false;
          }
        }
      }
      const seen = new Set(spans.map((s) => s.wayId));
      for (const s of rest) {
        if (seen.has(s.wayId)) return false;
        seen.add(s.wayId);
      }
      set({
        routeDraft: {
          ...rd,
          lastAnchor: anchor,
          spans: [...spans, ...rest.map((s) => ({ ...s }))],
        },
      });
      return true;
    },

    commitRouteDraft: () => {
      const rd = get().routeDraft;
      if (!rd) return null;
      if (rd.spans.length === 0) {
        set({ routeDraft: null });
        return null;
      }
      // A return-path draft belongs to a line that already exists: committing
      // it turns that line into a couplet rather than minting a second one.
      if (rd.returnFor) {
        const { serviceId, patternId } = rd.returnFor;
        const attached = get().attachReturnPath(serviceId, patternId, rd.spans);
        set({ routeDraft: null });
        return attached ? serviceId : null;
      }
      const id = get().createRoutedService(rd.spans, rd.modeId);
      set({ routeDraft: null });
      return id;
    },

    cancelRouteDraft: () => set({ routeDraft: null }),

    createRoutedService: (spans, modeId) => {
      const st = get();
      const resolvedModeId = modeId ?? st.draftModeId;
      const legs = materializeRouteSpans(st.system, spans);
      if (!legs) return null;
      const id = shortId();
      const service: Service = {
        id,
        name: `Line ${nextLineNumber++}`,
        modeId: resolvedModeId,
        color: st.draftColor,
        patterns: [{ id: shortId(), sections: oneSection(legs) }],
        frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
        spanStart: DEFAULT_SPAN_START,
        spanEnd: DEFAULT_SPAN_END,
      };
      // Routing over what's already there adds no infrastructure at all now —
      // only a service that names the stretches it uses.
      set((s) => ({
        system: touch({ ...s.system, services: [...s.system.services, service] }),
        selection: { kind: 'service', id },
      }));
      return id;
    },

    adoptExistingInfrastructure: (serviceId) => {
      const st = get();
      const service = st.system.services.find((sv) => sv.id === serviceId);
      if (!service) return 0;
      const allowed = new Set(mode(service.modeId).wayTypeIds);
      let sys = st.system;
      let rebound = 0;

      for (const pattern of service.patterns) {
        const oldWayIds = [...new Set(patternWayIds(pattern))];
        const sketchPath = patternPath(sys.ways, pattern);
        if (sketchPath.length < 2) continue;
        const exclude = new Set(oldWayIds);
        const candidates = sys.ways.filter((w) => allowed.has(w.typeId) && !exclude.has(w.id));
        const sA = snap(candidates, sketchPath[0], ADOPT_SNAP_M);
        const sB = snap(candidates, sketchPath[sketchPath.length - 1], ADOPT_SNAP_M);
        if (!sA || !sB) continue;
        const wayA = sys.ways.find((w) => w.id === sA.wayId);
        const wayB = sys.ways.find((w) => w.id === sB.wayId);
        if (!wayA || !wayB) continue;
        const from = anchorOnWay(wayA, sA.coord);
        const to = anchorOnWay(wayB, sB.coord);
        if (!from || !to) continue;
        // Adoption replaces a pattern's whole path with one routed line, which
        // for a couplet would silently discard the direction it was drawn
        // with. Refuse rather than flatten: the planner drew two one-way paths
        // on purpose, and re-routing each of them separately is a different
        // gesture than this one.
        if (patternHasSplit(pattern)) continue;
        // 'preferLegal': failure here is `continue`, which leaves the pattern
        // silently un-adopted with nothing said. A flagged adoption is the
        // better of the two, since the wrong-way issue then names it.
        const res = routeBetween(sys, from, to, {
          allowedTypeIds: allowed,
          excludeWayIds: exclude,
          biasPath: sketchPath,
          biasWeight: ADOPT_BIAS_WEIGHT,
          travel: 'preferLegal',
        });
        if (!res) continue;
        const adoptedLegs = materializeRouteSpans(sys, res.spans);
        if (!adoptedLegs) continue;
        const adoptedWayIds = [...new Set(adoptedLegs.map((l) => l.wayId))];

        // Swap the pattern onto the adopted ways.
        sys = {
          ...sys,
          services: sys.services.map((sv) =>
            sv.id === serviceId
              ? {
                  ...sv,
                  patterns: sv.patterns.map((p) =>
                    // Adoption replaces the whole path, so any direction
                    // structure it had goes with it — see the note on
                    // materializeRouteSpans about re-routing each direction.
                    p.id === pattern.id ? { ...p, sections: oneSection(adoptedLegs) } : p,
                  ),
                }
              : sv,
          ),
        };

        // Stations that rode the sketch follow the service onto the adopted
        // ways (nearest within tolerance); too far away, they detach but
        // survive as free stations rather than being deleted.
        const newWays = sys.ways.filter((w) => adoptedWayIds.includes(w.id));
        sys = {
          ...sys,
          stations: sys.stations.map((stn) => {
            if (!stn.anchors.some((a) => exclude.has(a.wayId))) return stn;
            let best: StationAnchor | undefined;
            let bestD = ADOPT_STATION_REANCHOR_M;
            for (const nw of newWays) {
              const on = nearestOnPath(resolveWayPath(nw), stn.coord);
              if (on && on.distMeters < bestD) {
                bestD = on.distMeters;
                best = { wayId: nw.id, t: on.t };
              }
            }
            // Too far from anything adopted: the station drops the anchors
            // that named the sketch and survives free, rather than being
            // deleted. Anchors on ways NOT being replaced are untouched.
            const detached = stn.anchors.filter((a) => !exclude.has(a.wayId));
            if (!best) return { ...stn, anchors: detached };
            return { ...stn, anchors: [best, ...detached.filter((a) => a.wayId !== best.wayId)] };
          }),
        };

        // Sketch geometry nothing rides anymore is redundant — but never
        // silently delete anything imported or deliberately named.
        for (const oldId of oldWayIds) {
          const w = sys.ways.find((x) => x.id === oldId);
          if (!w || w.source) continue;
          const ridden = sys.services.some((sv) =>
            sv.patterns.some((p) => patternLegs(p).some((l) => l.wayId === oldId)),
          );
          const named = sys.namedWays.some((n) => n.wayIds.includes(oldId));
          if (!ridden && !named) sys = removeWay(sys, oldId);
        }
        rebound++;
      }

      if (rebound > 0) set({ system: touch(sys) });
      return rebound;
    },

    reconcileImportedServices: (serviceIds) => {
      const result = reconcileImportedSystem(get().system, serviceIds);
      if (result.reconciled > 0) set({ system: touch(result.system) });
      return result.reconciled;
    },

    applyImportedReconciliation: ({ expectedSystem, result }) => {
      if (get().system !== expectedSystem) return false;
      if (result.reconciled > 0) set({ system: touch(result.system) });
      return true;
    },

    addServiceToWay: (wayId) => {
      const st = get();
      const way = st.system.ways.find((w) => w.id === wayId);
      const compatible = modesForWayType(way?.typeId ?? st.draftWayTypeId);
      if (compatible.length === 0) return null; // this way type carries no service (e.g. bike)
      const id = shortId();
      const modeId = compatible.some((m) => m.id === st.draftModeId)
        ? st.draftModeId
        : compatible[0].id;
      const color = unusedPaletteColor(st.system, modeId);
      // A freshly-drawn line gets a working default schedule immediately —
      // "drag a line, see a system running" shouldn't require a trip to the
      // Inspector first. DEFAULT_FREQUENCY_MINUTES/DEFAULT_SPAN mirror the
      // Inspector's own "10 min" / "6am–11pm" preset chips (see
      // ServiceInspector) so the value a fresh line starts at is never a
      // surprise once you do open the panel.
      const service: Service = {
        id,
        name: `Line ${nextLineNumber++}`,
        modeId,
        color,
        patterns: [{ id: shortId(), sections: oneSection([wholeLeg(wayId)]) }],
        frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
        spanStart: DEFAULT_SPAN_START,
        spanEnd: DEFAULT_SPAN_END,
      };
      set((s) => ({
        system: touch({ ...s.system, services: [...s.system.services, service] }),
        selection: { kind: 'service', id },
      }));
      return id;
    },

    setServiceName: (id, name) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) => (sv.id === id ? { ...sv, name } : sv)),
        }),
      })),
    setServiceColor: (id, color) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) => (sv.id === id ? { ...sv, color } : sv)),
        }),
      })),
    setServiceMode: (id, modeId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) => (sv.id === id ? { ...sv, modeId } : sv)),
        }),
      })),
    setServiceFrequency: (id, minutes) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id === id ? { ...sv, frequencyMinutes: minutes } : sv,
          ),
        }),
      })),
    setServiceSpan: (id, start, end) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id === id ? { ...sv, spanStart: start, spanEnd: end } : sv,
          ),
        }),
      })),
    setServiceSchedule: (id, periods) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id === id
              ? { ...sv, schedule: periods && periods.length > 0 ? periods : undefined }
              : sv,
          ),
        }),
      })),

    setVehicleKinds: (kinds) =>
      set((s) => ({ system: touch({ ...s.system, vehicleKinds: kinds }) })),
    setServiceVehicleKind: (id, vehicleKindId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) => (sv.id === id ? { ...sv, vehicleKindId } : sv)),
        }),
      })),

    deleteService: (id) =>
      set((s) => ({
        system: touch({ ...s.system, services: s.system.services.filter((sv) => sv.id !== id) }),
        selection: s.selection?.kind === 'service' && s.selection.id === id ? null : s.selection,
        activePatternId:
          s.selection?.kind === 'service' && s.selection.id === id ? null : s.activePatternId,
        armedTerminus: s.armedTerminus?.serviceId === id ? null : s.armedTerminus,
      })),

    startAddingPattern: (serviceId) => set({ addingPatternForServiceId: serviceId, tool: 'way' }),
    cancelAddingPattern: () => set({ addingPatternForServiceId: null }),
    deletePattern: (serviceId, patternId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id === serviceId && sv.patterns.length > 1
              ? { ...sv, patterns: sv.patterns.filter((p) => p.id !== patternId) }
              : sv,
          ),
        }),
        activePatternId:
          s.activePatternId === patternId
            ? (s.system.services
                .find((service) => service.id === serviceId)
                ?.patterns.find((pattern) => pattern.id !== patternId)?.id ?? null)
            : s.activePatternId,
        armedTerminus:
          s.armedTerminus?.serviceId === serviceId && s.armedTerminus.patternId === patternId
            ? null
            : s.armedTerminus,
      })),

    extendPatternTerminus: (serviceId, patternId, side, spans) => {
      const st = get();
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === patternId);
      const legs = materializeRouteSpans(st.system, spans);
      const extended = pattern && legs ? extendPatternTerminusInCore(pattern, side, legs) : null;
      if (!extended) return false;
      set((state) => ({
        system: touch({
          ...state.system,
          services: state.system.services.map((candidate) =>
            candidate.id !== serviceId
              ? candidate
              : {
                  ...candidate,
                  patterns: candidate.patterns.map((current) =>
                    current.id === patternId ? extended : current,
                  ),
                },
          ),
        }),
      }));
      return true;
    },

    commitTerminusGesture: (source, target, plan, choice) => {
      const current = get();
      const refuse = () => {
        if (current.armedTerminus) set({ armedTerminus: null });
        return false;
      };
      if (current.system !== plan.baseSystem) return refuse();
      if (plan.kind === 'refuse') return refuse();
      if (plan.kind === 'connection-choice' && !choice) return false;
      const service = plan.system.services.find((candidate) => candidate.id === source.serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === source.patternId);
      if (!service || !pattern) return refuse();

      if (plan.kind === 'connection-choice' && choice === 'through') {
        const targetServiceId =
          plan.targetServiceId ??
          (target.kind === 'service-position' ? target.serviceId : undefined);
        const joined =
          targetServiceId &&
          target.kind === 'service-position' &&
          target.terminus &&
          throughRouteServicesAt(plan.system, source.serviceId, targetServiceId, {
            aPatternId: source.patternId,
            aEnd: source.side,
            bPatternId: target.terminus.patternId,
            bEnd: target.terminus.side,
            distanceM: 0,
          });
        if (!joined) return refuse();
        set({
          system: touch(joined),
          selection: { kind: 'service', id: source.serviceId },
          activePatternId: source.patternId,
          armedTerminus: null,
        });
        return true;
      }

      const legs = materializeRouteSpans(plan.system, plan.spans) ?? [];
      const targetPosition = target.kind === 'service-position' ? target.position : undefined;
      const nextPattern =
        plan.kind === 'loop' || plan.kind === 'return'
          ? targetPosition
            ? closePatternTerminus(plan.system.ways, pattern, source.side, targetPosition, legs)
            : null
          : legs.length > 0
            ? extendPatternTerminusInCore(pattern, source.side, legs)
            : pattern;
      if (!nextPattern) return refuse();
      const nextSystem: TransitSystem = {
        ...plan.system,
        services: plan.system.services.map((candidate) =>
          candidate.id !== source.serviceId
            ? candidate
            : {
                ...candidate,
                patterns: candidate.patterns.map((currentPattern) =>
                  currentPattern.id === source.patternId ? nextPattern : currentPattern,
                ),
              },
        ),
      };
      set({
        system: touch(nextSystem),
        selection: { kind: 'service', id: source.serviceId },
        activePatternId: source.patternId,
        armedTerminus: null,
      });
      return true;
    },

    endPatternAt: (serviceId, position) => {
      const st = get();
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === position.patternId);
      const ended = pattern ? endPatternAtPosition(st.system.ways, pattern, position) : null;
      if (!ended) return false;
      set((state) => ({
        system: touch({
          ...state.system,
          services: state.system.services.map((candidate) =>
            candidate.id !== serviceId
              ? candidate
              : {
                  ...candidate,
                  patterns: candidate.patterns.map((current) =>
                    current.id === position.patternId ? ended.pattern : current,
                  ),
                },
          ),
        }),
      }));
      return true;
    },

    divideServiceAt: (serviceId, position) => {
      const st = get();
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === position.patternId);
      const division = pattern ? dividePatternAtPosition(st.system.ways, pattern, position) : null;
      if (!service || !division) return null;
      const newId = shortId();
      const spawned: Service = {
        ...service,
        id: newId,
        name: `${service.name} 2`,
        color: unusedPaletteColor(st.system, service.modeId),
        patterns: [{ ...division.divided, id: shortId() }],
      };
      set((state) => ({
        system: touch({
          ...state.system,
          services: [
            ...state.system.services.map((candidate) =>
              candidate.id !== serviceId
                ? candidate
                : {
                    ...candidate,
                    patterns: candidate.patterns.map((current) =>
                      current.id === position.patternId ? division.remaining : current,
                    ),
                  },
            ),
            spawned,
          ],
        }),
        selection: { kind: 'service', id: newId },
        activePatternId: spawned.patterns[0].id,
      }));
      return newId;
    },

    trimPatternAt: (serviceId, position, side) => {
      const st = get();
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === position.patternId);
      const trimmed = pattern
        ? trimPatternAtPosition(st.system.ways, pattern, position, side)
        : null;
      if (!trimmed) return false;
      set((state) => ({
        system: touch({
          ...state.system,
          services: state.system.services.map((candidate) =>
            candidate.id !== serviceId
              ? candidate
              : {
                  ...candidate,
                  patterns: candidate.patterns.map((current) =>
                    current.id === position.patternId ? trimmed : current,
                  ),
                },
          ),
        }),
      }));
      return true;
    },

    trimPatternTo: (serviceId, patternId, wayId, t, side) => {
      const st = get();
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service?.patterns.find((candidate) => candidate.id === patternId);
      if (!pattern) return false;
      // Trim at the leg NEAREST the end being moved, so dragging a terminus
      // back over a way the line visits twice shortens the right visit. On a
      // couplet this cuts both directions: the return trip's matching point
      // is found on its own street rather than assumed to be the same leg.
      const sections = trimSectionsTo(st.system.ways, pattern.sections, wayId, t, side);
      // Trimming a line away entirely is a deletion the user didn't ask for.
      if (!sections || sections.length === 0) return false;
      set((state) => ({
        system: touch({
          ...state.system,
          services: state.system.services.map((candidate) =>
            candidate.id !== serviceId
              ? candidate
              : {
                  ...candidate,
                  patterns: candidate.patterns.map((current) =>
                    current.id === patternId ? { ...current, sections } : current,
                  ),
                },
          ),
        }),
      }));
      return true;
    },

    setStopSkipped: (serviceId, patternId, run, stationId, skipped) =>
      set((s) => {
        const service = s.system.services.find((sv) => sv.id === serviceId);
        const pattern = service?.patterns.find((p) => p.id === patternId);
        if (!pattern) return {};
        const current = new Set(pattern.skippedStops?.[run] ?? []);
        if (skipped) current.add(stationId);
        else current.delete(stationId);
        // Dropped to absent rather than left as an empty list, so a pattern
        // nobody has skipped anything on serializes the way it always did.
        const next: Partial<Record<RunDirection, string[]>> = {
          ...pattern.skippedStops,
          [run]: [...current],
        };
        for (const key of ['outbound', 'inbound'] as const) {
          if ((next[key] ?? []).length === 0) delete next[key];
        }
        const { skippedStops: _drop, ...bare } = pattern;
        const updated =
          Object.keys(next).length > 0 ? { ...bare, skippedStops: next } : (bare as typeof pattern);
        return {
          system: touch({
            ...s.system,
            services: s.system.services.map((sv) =>
              sv.id !== serviceId
                ? sv
                : { ...sv, patterns: sv.patterns.map((p) => (p.id === patternId ? updated : p)) },
            ),
          }),
        };
      }),

    splitServiceAt: (serviceId, patternId, wayId, t) => {
      const st = get();
      const service = st.system.services.find((sv) => sv.id === serviceId);
      const pattern = service?.patterns.find((p) => p.id === patternId);
      if (!service || !pattern) return null;
      // Cutting a line in two is trimming it twice, from opposite ends — which
      // means a couplet's halves are each cut on both their streets, and each
      // half comes out a couplet in its own right. Doing it on the flattened
      // leg list, as this used to, would have handed back two flat lines and
      // silently thrown the direction structure away.
      const near = trimSectionsTo(st.system.ways, pattern.sections, wayId, t, 'end');
      const far = trimSectionsTo(st.system.ways, pattern.sections, wayId, t, 'start');
      // A cut on a terminus leaves nothing on one side — not a split.
      if (!near || !far || near.length === 0 || far.length === 0) return null;
      const nearPattern = { ...pattern, sections: near };
      const farPattern = { ...pattern, sections: far };
      const operatingMeters = (candidate: typeof pattern) =>
        pathLengthMeters(patternRunPath(st.system.ways, candidate, 'outbound')) +
        pathLengthMeters(patternRunPath(st.system.ways, candidate, 'inbound'));
      // A divide is asymmetric on purpose: the original service's identity
      // stays with the longer branch, while the shorter one becomes a new
      // line. Keeping the choice here also preserves couplet sections intact.
      const [remaining, divided] =
        operatingMeters(nearPattern) >= operatingMeters(farPattern)
          ? [nearPattern, farPattern]
          : [farPattern, nearPattern];
      const newId = shortId();
      // The shorter half keeps everything about the line except its identity:
      // same mode, schedule, and vehicle. A new colour keeps the two lines
      // distinguishable once they share a corridor.
      const spawned: Service = {
        ...service,
        id: newId,
        name: `${service.name} 2`,
        color: unusedPaletteColor(st.system, service.modeId),
        patterns: [{ ...divided, id: shortId() }],
      };
      set((s) => ({
        system: touch({
          ...s.system,
          services: [
            ...s.system.services.map((sv) =>
              sv.id !== serviceId
                ? sv
                : {
                    ...sv,
                    patterns: sv.patterns.map((p) => (p.id === patternId ? remaining : p)),
                  },
            ),
            spawned,
          ],
        }),
        selection: { kind: 'service', id: newId },
      }));
      return newId;
    },

    startReturnPathDraft: (serviceId, patternId) => {
      const st = get();
      const service = st.system.services.find((sv) => sv.id === serviceId);
      const pattern = service?.patterns.find((p) => p.id === patternId);
      if (!service || !pattern) return false;
      // Drawn FROM the far end of the outward trip, because that is where a
      // return trip starts. The planner then traces it back down whatever
      // streets carry the other direction.
      const out = patternRunPath(st.system.ways, pattern, 'outbound');
      if (out.length < 2) return false;
      const terminus = out[out.length - 1];
      // Anchored on the line's OWN last way, not on whatever way happens to be
      // nearest the terminus. At a junction those differ, and starting the
      // draft on a cross-street makes the first hop a seam the draft then has
      // to merge — which it will refuse.
      const runLegs = patternRunLegs(pattern, 'outbound');
      const lastWayId = runLegs[runLegs.length - 1]?.leg.wayId;
      const way = st.system.ways.find((w) => w.id === lastWayId);
      const anchorAt = way ? anchorOnWay(way, terminus) : null;
      if (!anchorAt) return false;
      set({
        routeDraft: {
          modeId: service.modeId,
          lastAnchor: anchorAt,
          spans: [],
          returnFor: { serviceId, patternId },
        },
      });
      return true;
    },

    attachReturnPath: (serviceId, patternId, spans) => {
      const st = get();
      const service = st.system.services.find((sv) => sv.id === serviceId);
      const pattern = service?.patterns.find((p) => p.id === patternId);
      if (!service || !pattern || spans.length === 0) return false;
      const returnLegs = materializeRouteSpans(st.system, spans);
      if (!returnLegs || returnLegs.length === 0) return false;

      // Where the return trip rejoins the outward one decides how much of the
      // line becomes a couplet: everything from there to the terminus, and
      // nothing before it. The draft's last anchor IS that point — it is where
      // the planner stopped drawing.
      const rejoin = spans[spans.length - 1];
      const endCoord = rejoin.toCoord ?? coordAtSpanEnd(st.system, rejoin);
      const outLegs = patternLegs(pattern);
      const cut = endCoord
        ? cutIndexOnLegs(st.system.ways, outLegs, endCoord, RETURN_REJOIN_SNAP_M)
        : null;
      // A return path that ends nowhere near the line has not rejoined it, and
      // guessing is the dangerous move: the only guess available is "the whole
      // line is a couplet", which silently splits it end to end when the
      // planner drew one block. Refuse and let them draw it again.
      if (!cut) return false;

      const [shared, diverged] = splitLegsAt(outLegs, cut.legIndex, cut.t);

      // Nothing diverged means the drawn path rejoins at the far END of the
      // line rather than partway down it: a loop round the block at the
      // terminus, ridden once and then the line comes back the way it went.
      // That is a turnaround, not a couplet — the whole line is still shared,
      // with the loop appended. It used to be refused, which is why nothing
      // could build a turnaround section at all.
      const sections = pruneSections(
        diverged.length === 0
          ? [...oneSection(outLegs), { kind: 'turnaround' as const, legs: returnLegs }]
          : [
              ...(shared.length > 0 ? oneSection(shared) : []),
              { kind: 'split' as const, outbound: diverged, inbound: returnLegs },
            ],
      );
      set((s) => ({
        system: touch({
          ...s.system,
          services: s.system.services.map((sv) =>
            sv.id !== serviceId
              ? sv
              : {
                  ...sv,
                  patterns: sv.patterns.map((p) => (p.id === patternId ? { ...p, sections } : p)),
                },
          ),
        }),
        routeDraft: null,
      }));
      return true;
    },

    makePatternTwoWay: (serviceId, patternId) =>
      set((s) => {
        const service = s.system.services.find((sv) => sv.id === serviceId);
        const pattern = service?.patterns.find((p) => p.id === patternId);
        if (!pattern || !patternHasSplit(pattern)) return {};
        // The outward trip's streets are the ones that survive: they are what
        // the line was before anyone drew a return path, and the return
        // streets are the addition being undone.
        const legs = patternRunLegs(pattern, 'outbound').map((r) => r.leg);
        return {
          system: touch({
            ...s.system,
            services: s.system.services.map((sv) =>
              sv.id !== serviceId
                ? sv
                : {
                    ...sv,
                    patterns: sv.patterns.map((p) =>
                      p.id === patternId ? { ...p, sections: oneSection(legs) } : p,
                    ),
                  },
            ),
          }),
        };
      }),

    deleteWayStretch: (wayId, fromT, toT) => {
      const st = get();
      const way = st.system.ways.find((w) => w.id === wayId);
      if (!way) return 0;
      const path = resolveWayPath(way);
      if (path.length < 2) return 0;
      const lo = Math.max(0, Math.min(1, Math.min(fromT, toT)));
      const hi = Math.max(0, Math.min(1, Math.max(fromT, toT)));
      if (hi - lo < MIN_STRETCH_T) return 0;

      // Every riding pattern is trimmed FIRST, against the way as it still is
      // — the extents are measured in its current parameterization, and the
      // splits below change that.
      let affected = 0;
      let sys: TransitSystem = {
        ...st.system,
        services: st.system.services.map((sv) => ({
          ...sv,
          patterns: sv.patterns.flatMap((p) => {
            const before = patternLegs(p);
            const legs = removeStretchFromLegs(before, wayId, lo, hi);
            if (legs.length === before.length && legs.every((l, i) => l === before[i])) return [p];
            affected++;
            if (legs.length === 0) return [];
            // Taking a stretch out from under a line can leave it in two
            // disconnected halves. Both survive, as two patterns of the one
            // service — dropping the shorter half would be throwing away half
            // a line without asking.
            // Against the ways as they still are: the splits below have not
            // happened yet, and these extents are in the current geometry.
            const runs = splitLegsIntoRuns(legs, (a, b) => legsMeet(st.system.ways, a, b));
            return runs.map((run, i) => ({
              ...p,
              id: i === 0 ? p.id : shortId(),
              sections: oneSection(run),
            }));
          }),
        })),
      };
      sys = { ...sys, services: sys.services.filter((sv) => sv.patterns.length > 0) };

      // Then cut the way itself: split at both ends of the stretch and remove
      // the middle. The HIGH end first — splitting there leaves the low end's
      // position untouched on the piece that keeps the original id, whereas
      // cutting low-first would move the high end onto a different way.
      const atHi = insertIndexAtT(sys, wayId, hi);
      if (atHi) sys = splitWay(atHi.system, wayId, atHi.index);
      const atLo = insertIndexAtT(sys, wayId, lo);
      // No cut at the low end means the stretch reaches the way's own start,
      // so the piece to remove is simply what is left holding the id.
      const middleId = shortId();
      if (atLo) sys = splitWay(atLo.system, wayId, atLo.index, middleId);
      sys = removeWay(sys, atLo ? middleId : wayId);

      set({ system: touch(sys) });
      return affected;
    },

    mergeWaysIntoCorridor: (wayIds) => {
      const st = get();
      let sys = st.system;
      // Longest first, for the same reason import conflation works that way: a
      // long trunk should be the corridor everything else joins, not a short
      // shuttle that happens to be processed first.
      const ordered = wayIds
        .map((id) => sys.ways.find((w) => w.id === id))
        .filter((w): w is Way => !!w)
        .sort((a, b) => wayLengthMeters(b) - wayLengthMeters(a));
      if (ordered.length < 2) return 0;

      // Grows as ways are kept: the second way fuses onto the first, and the
      // third onto whatever the first two became.
      const keepers = new Set<string>([ordered[0].id]);
      let absorbed = 0;
      for (const way of ordered.slice(1)) {
        // How far apart these two actually are, so an explicit merge is judged
        // by the ways the user pointed at rather than by the mode's automatic
        // caution. Without this the recovery for a duplicate street is refused
        // by the very tolerance that let the duplicate exist: a rail line 12 m
        // off a track is not conflated automatically (8 m), so asking for the
        // merge by hand would report "nothing to do".
        // Measured from the way being absorbed onto the keeper, not the other
        // way round: the keeper is the longer one, and its ends project past
        // the shorter way entirely.
        const separationM = maxSeparationM(way, ordered[0]);
        const toleranceM =
          separationM === null ? undefined : Math.min(separationM * 1.5 + 5, MERGE_MAX_TOLERANCE_M);
        for (const svc of sys.services) {
          for (const pattern of svc.patterns) {
            if (!patternLegs(pattern).some((l) => l.wayId === way.id)) continue;
            const next = conflatePatternOntoExisting(sys, svc.id, pattern.id, keepers, toleranceM);
            if (next) sys = next;
          }
        }
        // Absorbed means THIS way is gone — not that the system got smaller.
        // Fusing a way that overhangs its corridor removes it and mints a stub
        // for the part that genuinely isn't shared, leaving the count the same
        // while the merge did exactly what was asked.
        if (sys.ways.some((w) => w.id === way.id)) {
          // Nothing took it: not co-aligned with a keeper, or deliberately
          // named. It becomes a keeper itself, so a later way can still fuse
          // onto it.
          keepers.add(way.id);
        } else {
          absorbed++;
        }
      }

      if (absorbed > 0) set({ system: touch(sys), multiSelection: [], selection: null });
      return absorbed;
    },

    throughRouteInto: (keepId, otherId) => {
      const next = throughRouteServices(get().system, keepId, otherId);
      if (!next) return false;
      set((s) => ({
        system: touch(next),
        multiSelection: [],
        // The surviving line is what the person is now looking at, and the
        // one they picked second no longer exists to be selected.
        selection: { kind: 'service', id: keepId },
        cameraFocusToken: s.cameraFocusToken,
      }));
      return true;
    },

    mergeServiceInto: (sourceId, targetId) =>
      set((s) => {
        const source = s.system.services.find((sv) => sv.id === sourceId);
        const target = s.system.services.find((sv) => sv.id === targetId);
        if (!source || !target || source.id === target.id || source.modeId !== target.modeId)
          return {};
        // Each carried-over pattern keeps its own name if it already had one
        // (a source that was itself already branched); otherwise it's named
        // after the service it came from, so the merged list still reads as
        // "which physical line did this branch used to be."
        const carried = source.patterns.map((p) => ({ ...p, name: p.name ?? source.name }));
        return {
          system: touch({
            ...s.system,
            services: s.system.services
              .filter((sv) => sv.id !== sourceId)
              .map((sv) =>
                sv.id === targetId ? { ...sv, patterns: [...sv.patterns, ...carried] } : sv,
              ),
          }),
          selection:
            s.selection?.kind === 'service' && s.selection.id === sourceId
              ? { kind: 'service', id: targetId }
              : s.selection,
        };
      }),

    addStation: (coord, anchor) => {
      const station = createStation(coord, anchor);
      set((s) => ({
        system: touch({ ...s.system, stations: [...s.system.stations, station] }),
        selection: { kind: 'station', id: station.id },
        focusNameToken: s.focusNameToken + 1,
        focusNameStationId: station.id,
      }));
      return station.id;
    },

    consumeFocusName: (id) =>
      set((s) => (s.focusNameStationId === id ? { focusNameStationId: null } : {})),

    addDrawnStation: (footprint) => {
      const id = shortId();
      const cx = footprint.reduce((sum, p) => sum + p[0], 0) / footprint.length;
      const cy = footprint.reduce((sum, p) => sum + p[1], 0) / footprint.length;
      let coord: LngLat = [cx, cy];
      const hit = snap(get().system.ways, coord, STATION_DRAW_ANCHOR_M);
      if (hit) coord = hit.coord;
      const station: Station = {
        id,
        coord,
        anchors: hit ? [{ wayId: hit.wayId, t: hit.t }] : [],
        footprint,
      };
      set((s) => ({
        system: touch({ ...s.system, stations: [...s.system.stations, station] }),
        selection: { kind: 'station', id },
      }));
      return id;
    },

    moveStation: (id, coord, anchor) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === id ? { ...st, coord, anchor: anchor ?? undefined } : st,
          ),
        }),
      })),

    setStationName: (id, name) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) => (st.id === id ? { ...st, name } : st)),
        }),
      })),

    setStationDwellSeconds: (id, seconds) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === id ? { ...st, dwellSeconds: seconds } : st,
          ),
        }),
      })),

    // Undefined (not false) when off, so the flag round-trips out of the saved
    // document cleanly (serialize only writes majorStop === true).
    setStationMajorStop: (id, major) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === id ? { ...st, majorStop: major || undefined } : st,
          ),
        }),
      })),

    deleteStation: (id) =>
      set((s) => ({
        system: touch({ ...s.system, stations: s.system.stations.filter((st) => st.id !== id) }),
        selection: s.selection?.kind === 'station' && s.selection.id === id ? null : s.selection,
      })),

    addStationFootprint: (stationId) =>
      set((s) => {
        const station = s.system.stations.find((st) => st.id === stationId);
        if (!station || station.footprint) return s;
        const footprint = squareFootprint(station.coord, FOOTPRINT_HALF_SIZE_M);
        return {
          system: touch({
            ...s.system,
            stations: s.system.stations.map((st) =>
              st.id === stationId ? { ...st, footprint } : st,
            ),
          }),
        };
      }),

    moveFootprintPoint: (stationId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId && st.footprint
              ? { ...st, footprint: st.footprint.map((p, i) => (i === index ? coord : p)) }
              : st,
          ),
        }),
      })),

    deleteStationFootprint: (stationId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId ? { ...st, footprint: undefined, platforms: undefined } : st,
          ),
        }),
      })),

    addPlatform: (stationId) => {
      const platformId = shortId();
      set((s) => {
        const station = s.system.stations.find((st) => st.id === stationId);
        if (!station) return s;
        const platform: Platform = {
          id: platformId,
          points: squareFootprint(station.coord, PLATFORM_HALF_SIZE_M),
          edges: 1,
        };
        return {
          system: touch({
            ...s.system,
            stations: s.system.stations.map((st) =>
              st.id === stationId ? { ...st, platforms: [...(st.platforms ?? []), platform] } : st,
            ),
          }),
        };
      });
      return platformId;
    },

    movePlatformPoint: (stationId, platformId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId
              ? {
                  ...st,
                  platforms: (st.platforms ?? []).map((p) =>
                    p.id === platformId
                      ? { ...p, points: p.points.map((pt, i) => (i === index ? coord : pt)) }
                      : p,
                  ),
                }
              : st,
          ),
        }),
      })),

    deletePlatform: (stationId, platformId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          stations: s.system.stations.map((st) =>
            st.id === stationId
              ? { ...st, platforms: (st.platforms ?? []).filter((p) => p.id !== platformId) }
              : st,
          ),
        }),
      })),

    addFacility: (typeId, geometry) => {
      const facility = createFacility(typeId, geometry);
      const id = facility.id;
      set((s) => {
        let system: TransitSystem = { ...s.system, facilities: [...s.system.facilities, facility] };
        // THE BASE CONCEPT: a station's drawn border defines its land and
        // identity. A structure placed ON that land belongs to the station —
        // it joins the station's complex automatically (creating one if this
        // is the first structure), instead of floating as an unrelated
        // object the user must group by hand.
        const at: LngLat = Array.isArray(geometry[0])
          ? centroidOf(geometry as LngLat[])
          : (geometry as LngLat);
        const host = system.stations.find((st) => st.footprint && pointInPolygon(at, st.footprint));
        if (host) {
          const existing = system.groups.find((g) => g.memberIds.includes(host.id));
          system = existing
            ? {
                ...system,
                groups: system.groups.map((g) =>
                  g.id === existing.id ? { ...g, memberIds: [...g.memberIds, id] } : g,
                ),
              }
            : {
                ...system,
                groups: [
                  ...system.groups,
                  createGroupEntity([host.id, id], host.name ? `${host.name} complex` : undefined),
                ],
              };
        }
        return { system: touch(system), selection: { kind: 'facility', id } };
      });
      return id;
    },

    moveFacility: (id, geometry) =>
      set((s) => ({
        system: touch({
          ...s.system,
          facilities: s.system.facilities.map((f) => (f.id === id ? { ...f, geometry } : f)),
        }),
      })),

    setFacilityName: (id, name) =>
      set((s) => ({
        system: touch({
          ...s.system,
          facilities: s.system.facilities.map((f) => (f.id === id ? { ...f, name } : f)),
        }),
      })),

    deleteFacility: (id) =>
      set((s) => ({
        system: touch({ ...s.system, facilities: s.system.facilities.filter((f) => f.id !== id) }),
        selection: s.selection?.kind === 'facility' && s.selection.id === id ? null : s.selection,
      })),

    createGroup: (memberIds, name) => {
      const group = createGroupEntity(memberIds, name);
      set((s) => ({
        system: touch({ ...s.system, groups: [...s.system.groups, group] }),
        selection: { kind: 'group', id: group.id },
      }));
      return group.id;
    },

    addGroupMember: (groupId, memberId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) =>
            g.id === groupId && !g.memberIds.includes(memberId)
              ? { ...g, memberIds: [...g.memberIds, memberId] }
              : g,
          ),
        }),
      })),

    removeGroupMember: (groupId, memberId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) =>
            g.id === groupId ? { ...g, memberIds: g.memberIds.filter((m) => m !== memberId) } : g,
          ),
        }),
      })),

    renameGroup: (id, name) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) => (g.id === id ? { ...g, name } : g)),
        }),
      })),
    setGroupColor: (id, color) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) => (g.id === id ? { ...g, color } : g)),
        }),
      })),

    deleteGroup: (id) =>
      set((s) => ({
        system: touch({ ...s.system, groups: s.system.groups.filter((g) => g.id !== id) }),
        selection: s.selection?.kind === 'group' && s.selection.id === id ? null : s.selection,
      })),

    createFacilityComplex: (footprint) => {
      const id = shortId();
      const st = get();
      const usedColors = new Set(
        st.system.groups.filter((g) => g.color).map((g) => g.color!.toLowerCase()),
      );
      const color =
        st.system.palette.find((c) => !usedColors.has(c.toLowerCase())) ?? st.system.palette[0];
      const group: Group = { id, memberIds: [], footprint, color };
      set((s) => ({
        system: touch({ ...s.system, groups: [...s.system.groups, group] }),
        selection: { kind: 'group', id },
      }));
      return id;
    },

    addGroupFootprint: (groupId) =>
      set((s) => {
        const group = s.system.groups.find((g) => g.id === groupId);
        if (!group || group.footprint) return s;
        const center = liveCamera().center; // no single coord to anchor a plain group; center on the LIVE view (camera lives outside `system` now — see camera/liveCamera.ts)
        const footprint = squareFootprint(center, GROUP_FOOTPRINT_HALF_SIZE_M);
        return {
          system: touch({
            ...s.system,
            groups: s.system.groups.map((g) => (g.id === groupId ? { ...g, footprint } : g)),
          }),
        };
      }),

    moveGroupFootprintPoint: (groupId, index, coord) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) =>
            g.id === groupId && g.footprint
              ? { ...g, footprint: g.footprint.map((p, i) => (i === index ? coord : p)) }
              : g,
          ),
        }),
      })),

    deleteGroupFootprint: (groupId) =>
      set((s) => ({
        system: touch({
          ...s.system,
          groups: s.system.groups.map((g) =>
            g.id === groupId ? { ...g, footprint: undefined } : g,
          ),
        }),
      })),

    startPlacingFacility: (groupId) =>
      set({ placingFacilityForGroupId: groupId, pickingMemberForGroupId: null, tool: 'facility' }),
    cancelPlacingFacility: () => set({ placingFacilityForGroupId: null }),

    placeFacilityInGroup: (groupId, typeId, coord) => {
      const id = shortId();
      const facility: Facility = { id, typeId, geometry: coord };
      set((s) => ({
        system: touch({
          ...s.system,
          facilities: [...s.system.facilities, facility],
          groups: s.system.groups.map((g) =>
            g.id === groupId ? { ...g, memberIds: [...g.memberIds, id] } : g,
          ),
        }),
        selection: { kind: 'group', id: groupId },
        placingFacilityForGroupId: null,
        tool: 'select',
      }));
      return id;
    },

    startPickingMember: (groupId) =>
      set({ pickingMemberForGroupId: groupId, placingFacilityForGroupId: null, tool: 'select' }),
    cancelPickingMember: () => set({ pickingMemberForGroupId: null }),
  }));

  // The single place that turns "system changed" into "record an undo step" —
  // every action above stays a plain, unmodified `set(...)` call; this just
  // observes the store the same way any other subscriber would.
  editor.subscribe((state, prevState) => {
    if (state.system === prevState.system || skipHistory || checkpointBefore !== null) return;
    past.push(prevState.system);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    editor.setState({ canUndo: true, canRedo: false });
  });

  return editor;
}
