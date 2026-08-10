import type { DerivedServiceLevel } from './gtfsSchedule';
import { shortId } from './ids';
import type { Line, Pattern, Service } from './system';

interface GtfsServiceLookup {
  headsignByShape: ReadonlyMap<string, string>;
  shapeToTrip: ReadonlyMap<string, string>;
  stopTimesByTrip: ReadonlyMap<string, { seq: number; stopId: string }[]>;
  stopById: ReadonlyMap<string, { stop_name?: string }>;
}

interface GtfsRouteIdentity {
  route_short_name?: string;
  route_long_name?: string;
  route_color?: string;
}

export function lineFromGtfsRoute(
  route: GtfsRouteIdentity,
  routeId: string,
  serviceIds: string[],
): Line {
  const routeName = [route.route_short_name, route.route_long_name].find((name) => name?.trim());
  return {
    id: shortId(),
    name: routeName ?? `Route ${routeId}`,
    color: route.route_color ? `#${route.route_color}` : '#e4572e',
    serviceIds,
  };
}

export function gtfsServiceName(
  sourceShapes: string[],
  index: GtfsServiceLookup,
  ordinal: number,
): string {
  const headsigns = [
    ...new Set(sourceShapes.map((shapeId) => index.headsignByShape.get(shapeId)).filter(Boolean)),
  ] as string[];
  if (headsigns.length === 1) return headsigns[0];
  const representativeTrip = sourceShapes.at(0)
    ? index.shapeToTrip.get(sourceShapes[0])
    : undefined;
  const stops = representativeTrip
    ? [...(index.stopTimesByTrip.get(representativeTrip) ?? [])].sort((a, b) => a.seq - b.seq)
    : [];
  const first = stops.at(0);
  const last = stops.at(-1);
  const firstName = first ? index.stopById.get(first.stopId)?.stop_name : undefined;
  const lastName = last ? index.stopById.get(last.stopId)?.stop_name : undefined;
  return firstName && lastName && firstName !== lastName
    ? `${firstName}–${lastName}`
    : `Service ${ordinal}`;
}

export function serviceFromGtfsPattern(
  pattern: Pattern,
  modeId: string,
  name: string | undefined,
  serviceLevel: DerivedServiceLevel | undefined,
): Service {
  return {
    id: pattern.id,
    ...(name ? { name } : {}),
    modeId,
    path: {
      id: pattern.id,
      sections: pattern.sections,
      ...(pattern.skippedStops ? { skippedStops: pattern.skippedStops } : {}),
    },
    ...(serviceLevel ?? {}),
  };
}
