import type { FeatureCollection, LineString, Point } from 'geojson';
import { patternLegs } from '@transitmapper/core/model/geo';
import type { Service, TransitSystem } from '@transitmapper/core/model/system';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import { SRC_SERVICE_ARROWS, SRC_SERVICE_TERMINI, SRC_SERVICES } from '../layers/constants';
import { buildFeaturesForSources } from './source-feature-projection';

/** One short-lived operational path shown only while an editor explicitly
 * inspects it. This value has no MapLibre or editor-store dependency, so the
 * Worker can build it without inheriting browser state. */
export interface PatternOverlayFeatures {
  readonly path: FeatureCollection<LineString>;
  readonly arrows: FeatureCollection<LineString>;
  readonly termini: FeatureCollection<Point>;
}

export interface PatternOverlayProjectionInput {
  readonly system: TransitSystem;
  readonly serviceId: string;
  readonly patternId: string;
  readonly view: RenderViewOptions;
  readonly armedTerminus?: {
    serviceId: string;
    patternId: string;
    side: 'start' | 'end';
  } | null;
}

function emptyLineFeatures(): FeatureCollection<LineString> {
  return { type: 'FeatureCollection', features: [] };
}

function emptyPointFeatures(): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: [] };
}

function emptyPatternOverlay(): PatternOverlayFeatures {
  return {
    path: emptyLineFeatures(),
    arrows: emptyLineFeatures(),
    termini: emptyPointFeatures(),
  };
}

function selectedService(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
): Service | null {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  return service?.path.id === patternId ? service : null;
}

/** Scope the legacy v16 document to one path before feature construction.
 * Filtering Services prevents an editor overlay from paying for, or exposing,
 * sibling operational paths. Filtering Ways gives the projection a bounded
 * working set while leaving the original document untouched. */
function systemForPatternOverlay(system: TransitSystem, service: Service): TransitSystem {
  const wayIds = new Set(patternLegs(service.path).map((leg) => leg.wayId));
  return {
    ...system,
    ways: system.ways.filter((way) => wayIds.has(way.id)),
    services: [service],
    lines: system.lines
      .filter((line) => line.serviceIds.includes(service.id))
      .map((line) => ({ ...line, serviceIds: [service.id] })),
  };
}

function matchingArmedTerminus(
  armedTerminus: PatternOverlayProjectionInput['armedTerminus'],
  serviceId: string,
  patternId: string,
): PatternOverlayProjectionInput['armedTerminus'] {
  return armedTerminus?.serviceId === serviceId && armedTerminus.patternId === patternId
    ? armedTerminus
    : null;
}

/** Projects the one exact Pattern currently opened by the editor. The caller
 * publishes these detached collections to editor-only sources; they never
 * enter a committed RenderScene, document source bank, export, or viewer. */
export function projectPatternOverlay({
  system,
  serviceId,
  patternId,
  view,
  armedTerminus = null,
}: PatternOverlayProjectionInput): PatternOverlayFeatures {
  if (view.viewMode === 'diagram') return emptyPatternOverlay();
  const service = selectedService(system, serviceId, patternId);
  if (!service) return emptyPatternOverlay();
  const features = buildFeaturesForSources({
    system: systemForPatternOverlay(system, service),
    selection: { kind: 'service', id: service.id },
    handleWayIds: [],
    view,
    sourceIds: [SRC_SERVICES, SRC_SERVICE_ARROWS, SRC_SERVICE_TERMINI],
    activePatternId: patternId,
    armedTerminus: matchingArmedTerminus(armedTerminus, serviceId, patternId),
  });
  return {
    path: features.services,
    arrows: features.serviceArrows,
    termini: features.serviceTermini,
  };
}
