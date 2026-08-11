// What the camera should frame when a chrome-driven selection happens (the
// Objects list, keyboard nav, Inspector "jump to member" links, Issues) —
// the editor selection commands bump cameraFocusToken and MapCanvas consumes
// it. Lives under map/ (not model/geo.ts) because it depends on
// Selection, an editor-state concept the domain model itself knows nothing
// about.
import type { Selection } from '../editor/store';
import { resolveWayPath, serviceWayIds } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';

export interface SelectionFocus {
  /** Bounding box to frame the camera on. */
  bounds: [LngLat, LngLat];
  /** True when the Network view renders nothing for this selection at all
   *  (its line/marker/footprint only ever exists in Infrastructure — see
   *  map/layers.ts's buildFeatures) — MapCanvas switches view before
   *  framing it, so the thing you just selected is actually visible. */
  needsInfrastructureView: boolean;
}

function bboxOf(coords: LngLat[]): [LngLat, LngLat] | null {
  if (coords.length === 0) return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function memberCoords(system: TransitSystem, memberIds: string[]): LngLat[] {
  const coords: LngLat[] = [];
  for (const id of memberIds) {
    const st = system.stations.find((s) => s.id === id);
    if (st) coords.push(st.coord);
    const f = system.facilities.find((f) => f.id === id);
    if (f)
      coords.push(
        ...(Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[]) : [f.geometry as LngLat]),
      );
    const w = system.ways.find((w) => w.id === id);
    if (w) coords.push(...resolveWayPath(w));
    const line = system.lines.find((candidate) => candidate.id === id);
    const serviceIds = line ? new Set(line.serviceIds) : new Set([id]);
    const wayIds = new Set(
      system.services
        .filter((service) => serviceIds.has(service.id))
        .flatMap((service) => serviceWayIds(service)),
    );
    coords.push(
      ...system.ways.filter((way) => wayIds.has(way.id)).flatMap((way) => resolveWayPath(way)),
    );
  }
  return coords;
}

function focusBounds(coords: LngLat[], needsInfrastructureView: boolean): SelectionFocus | null {
  const bounds = bboxOf(coords);
  return bounds ? { bounds, needsInfrastructureView } : null;
}

function wayFocus(system: TransitSystem, id: string, relatedIds?: string[]): SelectionFocus | null {
  const selectedWayIds = new Set(relatedIds ?? [id]);
  const coords = system.ways
    .filter((way) => selectedWayIds.has(way.id))
    .flatMap((way) => resolveWayPath(way));
  const served = system.services.some((service) =>
    serviceWayIds(service).some((wayId) => selectedWayIds.has(wayId)),
  );
  return focusBounds(coords, !served);
}

function serviceFocus(system: TransitSystem, id: string, stopId?: string): SelectionFocus | null {
  const station = stopId ? system.stations.find((candidate) => candidate.id === stopId) : undefined;
  if (station) return focusBounds([station.coord], false);
  const service = system.services.find((candidate) => candidate.id === id);
  if (!service) return null;
  const wayIds = new Set(serviceWayIds(service));
  return focusBounds(
    system.ways.filter((way) => wayIds.has(way.id)).flatMap((way) => resolveWayPath(way)),
    false,
  );
}

function lineFocus(system: TransitSystem, id: string): SelectionFocus | null {
  const line = system.lines.find((candidate) => candidate.id === id);
  if (!line) return null;
  const serviceIds = new Set(line.serviceIds);
  const wayIds = new Set(
    system.services
      .filter((service) => serviceIds.has(service.id))
      .flatMap((service) => serviceWayIds(service)),
  );
  return focusBounds(
    system.ways.filter((way) => wayIds.has(way.id)).flatMap((way) => resolveWayPath(way)),
    false,
  );
}

function groupFocus(system: TransitSystem, id: string): SelectionFocus | null {
  const group = system.groups.find((candidate) => candidate.id === id);
  if (!group) return null;
  return group.footprint
    ? focusBounds(group.footprint, true)
    : focusBounds(memberCoords(system, group.memberIds), false);
}

function nodeFocus(system: TransitSystem, id: string): SelectionFocus | null {
  const node = system.nodes.find((candidate) => candidate.id === id);
  if (!node) return null;
  const pad = 0.0012;
  return {
    bounds: [
      [node.coord[0] - pad, node.coord[1] - pad],
      [node.coord[0] + pad, node.coord[1] + pad],
    ],
    needsInfrastructureView: true,
  };
}

export function selectionFocus(system: TransitSystem, selection: Selection): SelectionFocus | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'station': {
      const station = system.stations.find((candidate) => candidate.id === selection.id);
      return station ? focusBounds([station.coord, ...(station.footprint ?? [])], false) : null;
    }
    case 'facility': {
      const facility = system.facilities.find((candidate) => candidate.id === selection.id);
      if (!facility) return null;
      const coords = Array.isArray(facility.geometry[0])
        ? (facility.geometry as LngLat[])
        : [facility.geometry as LngLat];
      return focusBounds(coords, true);
    }
    case 'way':
      return wayFocus(system, selection.id, selection.relatedIds);
    case 'service':
      return serviceFocus(system, selection.id, selection.stopId);
    case 'line':
      return lineFocus(system, selection.id);
    case 'group':
      return groupFocus(system, selection.id);
    case 'node':
      return nodeFocus(system, selection.id);
    default:
      return null;
  }
}
