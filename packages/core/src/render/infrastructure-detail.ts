import type { Feature, LineString } from 'geojson';
import { wayIntersectsBounds } from '../geometry/streets';
import type { LngLat, Way } from '../model/system';

interface InfrastructureDetailView {
  viewMode: string;
  visibleWayTypes: Set<Way['typeId']>;
  bounds?: [LngLat, LngLat];
  zoom?: number;
}

export function isOsmImportedWay(way: Way): boolean {
  return way.source?.startsWith('osm:') ?? false;
}

export function showsImportedWayAtDetail(
  way: Way,
  view: InfrastructureDetailView,
  selectedWayId: string | null,
): boolean {
  if (view.viewMode !== 'infrastructure' || !isOsmImportedWay(way) || way.id === selectedWayId) {
    return true;
  }
  if (view.bounds && !wayIntersectsBounds(way, view.bounds)) return false;
  if (view.zoom === undefined || view.zoom >= 13) return true;
  if (way.typeId === 'heavyRail' || way.typeId === 'lightRail') return true;
  if (way.typeId !== 'road') return false;
  if (view.zoom < 11) return way.classId === 'transitway' || way.classId === 'arterial';
  return ['transitway', 'arterial', 'collector'].includes(way.classId ?? '');
}

export function importedCenterlineFeature(options: {
  way: Way;
  path: LngLat[];
  color: string;
  width: number;
  dashed: boolean;
}): Feature<LineString> {
  const { way, path, color, width, dashed } = options;
  return {
    type: 'Feature',
    properties: { id: way.id, color, width, dashed, offset: 0 },
    geometry: { type: 'LineString', coordinates: path },
  };
}

export function shouldProjectWayLabel(
  way: Way | undefined,
  view: InfrastructureDetailView,
  selectedWayId: string | null,
): way is Way {
  return Boolean(
    way &&
    view.visibleWayTypes.has(way.typeId) &&
    showsImportedWayAtDetail(way, view, selectedWayId),
  );
}

export function showsTopologyWay(
  way: Way,
  view: InfrastructureDetailView,
  selectedWayId: string | null,
): boolean {
  return view.visibleWayTypes.has(way.typeId) && showsImportedWayAtDetail(way, view, selectedWayId);
}
