import type { Grade } from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type {
  LngLat,
  Line,
  LineGeometry,
  Node,
  Service,
  TransitSystem,
  Viewport,
  Way,
} from '@transitmapper/core/model/system';

function stableProfile(typeId: string, id: string) {
  return {
    lanes: defaultProfileFor(typeId).lanes.map((lane, index) => ({
      ...lane,
      id: `${id}-lane-${index}`,
    })),
  };
}

interface RendererWayOptions {
  typeId?: string;
  geometry?: LineGeometry;
  grade?: Grade;
}

export function rendererWay(
  id: string,
  points: LngLat[],
  { typeId = 'road', geometry = 'straight', grade = 'atGrade' }: RendererWayOptions = {},
): Way {
  return {
    id,
    typeId,
    points,
    geometry,
    grade,
    profile: stableProfile(typeId, id),
  };
}

interface RendererSystemOptions {
  id: string;
  name: string;
  viewport: Viewport;
  ways: Way[];
  nodes?: Node[];
  lines?: Line[];
  services?: Service[];
}

export function rendererSystem({
  id,
  name,
  viewport,
  ways,
  nodes = [],
  lines = [],
  services = [],
}: RendererSystemOptions): TransitSystem {
  return {
    ...createEmptySystem(0),
    id,
    name,
    viewport,
    ways,
    nodes,
    lines,
    services,
  };
}

function coordinateKey(coord: LngLat): string {
  return `${coord[0]},${coord[1]}`;
}

export function sharedEndpointNodes(prefix: string, ways: readonly Way[]): Node[] {
  const candidates = new Map<string, { coord: LngLat; refs: Node['refs'] }>();
  for (const way of ways) {
    for (let pointIndex = 0; pointIndex < way.points.length; pointIndex++) {
      const coord = way.points[pointIndex];
      const key = coordinateKey(coord);
      const candidate = candidates.get(key) ?? { coord, refs: [] };
      candidate.refs.push({ wayId: way.id, pointIndex });
      candidates.set(key, candidate);
    }
  }
  return [...candidates.values()]
    .filter((candidate) => candidate.refs.length > 1)
    .map((candidate, index) => ({
      id: `${prefix}-node-${index}`,
      coord: candidate.coord,
      refs: candidate.refs,
    }));
}

export function singleWayService(id: string, name: string, wayId: string): Service {
  return {
    id,
    name,
    modeId: 'bus',
    frequencyMinutes: 10,
    path: { id, sections: oneSection([wholeLeg(wayId)]) },
  };
}

/** The renderer fixtures use real public Lines: Services carry operations,
 * while colour and rider-facing naming belong to the Line that groups them. */
export function rendererLine(service: Service, color: string): Line {
  return {
    id: `${service.id}-line`,
    name: service.name ?? service.id,
    color,
    serviceIds: [service.id],
  };
}
