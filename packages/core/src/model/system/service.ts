import type { ScheduleDayScope } from './valueTypes';
import { removeGroupMembers } from './group';

/** The public identity a transportation agency designates on its map. */
export interface Line {
  id: string;
  name: string;
  color: string;
  serviceIds: string[];
}

/**
 * One way in a pattern's path, and how much of it the pattern uses.
 *
 * A leg exists so a service can cover PART of a way. Before it, a pattern held
 * a bare list of way ids, so a service that started or stopped mid-block had
 * to be made to fit by splitting the way underneath it — which mutated that
 * way for every other service riding it, reanchored every stop on it, and
 * left a permanent fragment behind. A corridor carrying many lines
 * accumulated one fragment per line that terminated on it. Extents are how a
 * service stops doing that.
 */
/** Which way round a leg runs its way, relative to that way's own stored
 *  point order. Stored rather than derived: the geometry cannot always
 *  determine it (a single-way pattern, a neighbour sharing both endpoints),
 *  and a wrong guess used to mean "wrong lane" but now means "the wrong half
 *  of the way". geo/servicePaths.ts's deriveLegDirections supplies it wherever
 *  a caller has only geometry. */
export type LegDirection = 'withPoints' | 'againstPoints';

/**
 * How much of its way a leg uses.
 *
 * A union rather than a pair of optional numbers, because "covers the whole
 * way" is a real state and not an absence: patternEdits' withRange drops the
 * numbers entirely when a leg grows to cover everything, precisely so the
 * common case round-trips through serialization without numbers that mean "no
 * trim". Two independent optionals also admit a `fromT` with no `toT`, which
 * has never meant anything.
 *
 * `fromT`/`toT` are normalized arc-length along the way's OWN resolved path —
 * the same 0-at-the-first-point convention as StopAnchor.t, not travel
 * order — so `direction` stays the only thing that says which way round.
 */
export type LegExtent = { kind: 'whole' } | { kind: 'stretch'; fromT: number; toT: number };

/**
 * Which lane of its way a leg rides.
 *
 * `'auto'` resolves at render time to the rightmost travel lane in the
 * direction of travel, or a dedicated bus lane / the direction's track — see
 * profile.ts's `defaultLaneFor`. It is distinct from a pin that happens to
 * name today's default: re-profiling the street moves an `'auto'` leg with it
 * and leaves a pinned one where the user put it.
 */
export type LegLane = { kind: 'auto' } | { kind: 'pinned'; laneId: string };

export interface PatternLeg {
  wayId: string;
  direction: LegDirection;
  extent: LegExtent;
  lane: LegLane;
}

/** Which of a line's two directions of service is being asked about. NOT the
 *  same axis as LegDirection: that one is about a way's stored point order,
 *  this one is about which trip a rider is on. sim/fleet.ts's RunPhase is
 *  built from this so the two vocabularies cannot drift apart. */
export type RunDirection = 'outbound' | 'inbound';

/**
 * One stretch of a pattern, and which directions of service ride it.
 *
 * A section rather than a per-leg tag, because the alternative cannot express
 * the constraint that matters. Tagging legs in one flat array makes an
 * inbound-only leg's POSITION load-bearing — put it after the shared leg it
 * should precede and the return path silently reads discontinuous — and the
 * type permits both spellings, so only a validator tells them apart. Here the
 * two halves of a couplet are held by the object containing them, and the
 * broken spelling cannot be written.
 *
 * - `shared` — both directions ride these legs, the return one flipped. Every
 *   pattern in every document before v12 is exactly one of these, which is why
 *   nothing about an existing line changes.
 * - `split` — the directions part company: a one-way couplet, or a stretch one
 *   direction skips. The two leg lists are each in their OWN ride order.
 * - `turnaround` — ridden once, at the point the vehicle reverses. A loop
 *   round a block at a terminus, which belongs to neither direction.
 */
export type PatternSection =
  | { kind: 'shared'; legs: PatternLeg[] }
  | { kind: 'split'; outbound: PatternLeg[]; inbound: PatternLeg[] }
  | { kind: 'turnaround'; legs: PatternLeg[] };

/** One operational path. A Service owns exactly one; agency-designated Lines
 *  group sibling Services when multiple paths share a public identity.
 *
 *  Directions are still two runs of ONE path (see PatternSection), because
 *  they share a stop derivation, headway, and fleet. */
export interface Pattern {
  id: string;
  /** The pattern's path, in sections ordered along OUTBOUND travel.
   *
   *  The outbound run reads them in order, taking `legs` or `outbound`. The
   *  inbound run reads them in REVERSE, taking `legs` or `inbound`, reversed
   *  within each section and each leg's travel direction flipped.
   *
   *  Consecutive legs must meet WITHIN a direction; validate.ts walks each
   *  direction separately, since a couplet's two halves deliberately do not
   *  touch. */
  sections: PatternSection[];
  /**
   * Stops this pattern passes but does NOT call at, per direction.
   *
   * The one exception to derived stops, and it exists for exactly one case: a
   * stop on a stretch BOTH directions ride, served in one direction only. That
   * stretch is one `shared` section, so there is nothing per-direction to hang
   * the omission on and nothing else in the model can say it. Where the two
   * directions ride different ways — a couplet — the derivation already gets
   * it right and this is not involved.
   *
   * A denylist rather than a list of the stops that ARE served, because stops
   * are derived: adding a stop to a corridor adds it to every line running
   * past, which is the behaviour the whole model is built on. An explicit
   * served-list would have to be maintained by every stop edit anywhere,
   * and a stale one silently LOSES stops. A denylist can only go stale by
   * naming a stop that no longer exists, which the parser drops.
   *
   * Absent — the case for every pattern in every document before v13 — skips
   * nothing.
   */
  skippedStops?: Partial<Record<RunDirection, string[]>>;
}

/** The one operational path owned by a Service. Its id matches the Service id
 *  so existing geometry operations can address the path without introducing
 *  a second identity. */
export type ServicePath = Pattern;

/** One named headway period within a service's full schedule — "Peak",
 *  "Off-Peak", "Weekend", etc. GTFS `frequencies.txt`-shaped (a headway +
 *  a time window), not explicit per-trip stop_times: real enough to plan
 *  around, without exploding into a per-stop timetable editor. */
export interface SchedulePeriod {
  id: string;
  label: string;
  days: ScheduleDayScope;
  /** First and last departure this period covers, 24h "HH:MM". */
  spanStart: string;
  spanEnd: string;
  /** Headway in minutes — how often a vehicle departs during this period. */
  frequencyMinutes: number;
}

/** One mode-specific operation beneath a public Line. */
export interface Service {
  id: string;
  /** Required only when a Line has multiple Services to distinguish. */
  name?: string;
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** A specific VehicleKind (system.vehicleKinds) this service runs —
   *  unset (the common case) uses the mode's plain default size/speed. */
  vehicleKindId?: string;
  path: ServicePath;
  /** Peak headway in minutes — how often a vehicle departs at the busiest
   *  time of day. Undefined = not yet specified. This is the quick,
   *  always-present control (Inspector's "Peak headway" field, and what
   *  vehicle animation falls back to); `schedule` below is the optional,
   *  more detailed alternative — when present, it supersedes this pair for
   *  anything schedule-aware, and the Inspector's simple fields become a
   *  read-only summary pointing at "Edit full schedule" instead. */
  frequencyMinutes?: number;
  /** Span of service — first and last departure, 24h "HH:MM". */
  spanStart?: string;
  spanEnd?: string;
  /** Optional detailed schedule — multiple named headway periods (e.g. Peak
   *  vs. Off-Peak vs. Weekend) instead of one flat headway+span. Undefined
   *  or empty = this service just uses frequencyMinutes/spanStart/spanEnd
   *  above. See ScheduleDialog.tsx. */
  schedule?: SchedulePeriod[];
}

interface ServiceDocument {
  services: Service[];
}

interface VehicleKindAwareServiceDocument extends ServiceDocument {
  vehicleKinds: { id: string; modeId: string }[];
}

interface LineDocument {
  lines: Line[];
}

interface LineServiceDocument extends LineDocument, ServiceDocument {}

interface LineServiceGroupDocument extends LineServiceDocument {
  groups: import('./group').Group[];
}

function replaceService<System extends ServiceDocument>(
  system: System,
  id: string,
  update: (service: Service) => Service,
): System {
  const index = system.services.findIndex((service) => service.id === id);
  if (index < 0) return system;
  const current = system.services[index];
  const service = update(current);
  if (service === current) return system;
  const services = [...system.services];
  services[index] = service;
  return { ...system, services };
}

function setServiceProperty<System extends ServiceDocument, Property extends keyof Service>(
  system: System,
  id: string,
  property: Property,
  value: Service[Property],
): System {
  return replaceService(system, id, (service) =>
    Object.is(service[property], value) ? service : { ...service, [property]: value },
  );
}

export function setServiceName<System extends ServiceDocument>(
  system: System,
  id: string,
  name: string,
): System {
  return setServiceProperty(system, id, 'name', name);
}

export function setServiceMode<System extends VehicleKindAwareServiceDocument>(
  system: System,
  id: string,
  modeId: string,
): System {
  return replaceService(system, id, (service) => {
    if (service.modeId === modeId) return service;
    const assignedKind = service.vehicleKindId
      ? system.vehicleKinds.find((kind) => kind.id === service.vehicleKindId)
      : undefined;
    if (assignedKind?.modeId === modeId) return { ...service, modeId };
    // Vehicle assignments are mode-scoped. Keeping an incompatible hidden id
    // would make simulation use equipment the inspector can no longer show.
    const updated = { ...service, modeId };
    delete updated.vehicleKindId;
    return updated;
  });
}

export function setServiceFrequency<System extends ServiceDocument>(
  system: System,
  id: string,
  frequencyMinutes: number | undefined,
): System {
  return setServiceProperty(system, id, 'frequencyMinutes', frequencyMinutes);
}

export function setServiceSpan<System extends ServiceDocument>(
  system: System,
  id: string,
  spanStart: string | undefined,
  spanEnd: string | undefined,
): System {
  return replaceService(system, id, (service) =>
    service.spanStart === spanStart && service.spanEnd === spanEnd
      ? service
      : { ...service, spanStart, spanEnd },
  );
}

function schedulesEqual(
  left: SchedulePeriod[] | undefined,
  right: SchedulePeriod[] | undefined,
): boolean {
  if (left === right) return true;
  if (left?.length !== right?.length) return false;
  if (left === undefined || right === undefined) return false;
  return left.every((period, index) => {
    const other = right[index];
    return (
      period.id === other.id &&
      period.label === other.label &&
      period.days === other.days &&
      period.spanStart === other.spanStart &&
      period.spanEnd === other.spanEnd &&
      period.frequencyMinutes === other.frequencyMinutes
    );
  });
}

export function setServiceSchedule<System extends ServiceDocument>(
  system: System,
  id: string,
  periods: SchedulePeriod[] | undefined,
): System {
  const schedule = periods && periods.length > 0 ? periods : undefined;
  return replaceService(system, id, (service) =>
    schedulesEqual(service.schedule, schedule) ? service : { ...service, schedule },
  );
}

export function setServiceVehicleKind<System extends ServiceDocument>(
  system: System,
  id: string,
  vehicleKindId: string | undefined,
): System {
  return setServiceProperty(system, id, 'vehicleKindId', vehicleKindId);
}

function replaceLine<System extends LineDocument>(
  system: System,
  id: string,
  update: (line: Line) => Line,
): System {
  const index = system.lines.findIndex((line) => line.id === id);
  if (index < 0) return system;
  const current = system.lines[index];
  const line = update(current);
  if (line === current) return system;
  const lines = [...system.lines];
  lines[index] = line;
  return { ...system, lines };
}

export function setLineName<System extends LineDocument>(
  system: System,
  id: string,
  name: string,
): System {
  return replaceLine(system, id, (line) => (line.name === name ? line : { ...line, name }));
}

export function setLineColor<System extends LineDocument>(
  system: System,
  id: string,
  color: string,
): System {
  return replaceLine(system, id, (line) => (line.color === color ? line : { ...line, color }));
}

/** Delete one public Line and every operational Service it owns. */
export function deleteLine<System extends LineServiceGroupDocument>(
  system: System,
  id: string,
): System {
  const line = system.lines.find((candidate) => candidate.id === id);
  if (!line) return system;
  const removedServiceIds = new Set(line.serviceIds);
  const services = system.services.filter((service) => !removedServiceIds.has(service.id));
  return removeGroupMembers(
    {
      ...system,
      lines: system.lines.filter((candidate) => candidate !== line),
      services: services.length === system.services.length ? system.services : services,
    },
    new Set([id, ...removedServiceIds]),
  );
}

/** Move one Service between public Lines, removing an emptied source Line. */
export function moveServiceToLine<System extends LineServiceGroupDocument>(
  system: System,
  serviceId: string,
  targetLineId: string,
): System {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  const sourceLine = system.lines.find((line) => line.serviceIds.includes(serviceId));
  const targetLine = system.lines.find((line) => line.id === targetLineId);
  if (!service || !sourceLine || !targetLine || sourceLine === targetLine) return system;

  const services = service.name
    ? system.services
    : system.services.map((candidate) =>
        candidate === service ? { ...candidate, name: sourceLine.name } : candidate,
      );
  const lines = system.lines
    .map((line) => {
      if (line === targetLine) return { ...line, serviceIds: [...line.serviceIds, serviceId] };
      if (line !== sourceLine) return line;
      return { ...line, serviceIds: line.serviceIds.filter((id) => id !== serviceId) };
    })
    .filter((line) => line.serviceIds.length > 0);
  return removeGroupMembers(
    { ...system, services, lines },
    new Set(lines.some((line) => line.id === sourceLine.id) ? [] : [sourceLine.id]),
  );
}

/** Move several Services under one public Line in the supplied order. */
export function moveServicesToLine<System extends LineServiceGroupDocument>(
  system: System,
  serviceIds: readonly string[],
  targetLineId: string,
): System {
  return serviceIds.reduce(
    (current, serviceId) => moveServiceToLine(current, serviceId, targetLineId),
    system,
  );
}
