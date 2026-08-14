/**
 * Renderer invalidation operations shared by editor commands.
 *
 * Commands use these after a core transform has produced the next system. The
 * result describes the smallest physical records that must be prepared again;
 * it does not read the store, choose a tool, or publish a scene. Keeping that
 * work here lets independent command groups share one invalidation rule
 * without coupling their command APIs.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  RenderPreparationEntityPatch,
  RenderPreparationPatch,
} from '@transitmapper/core/render/render-preparation';
import type { MultiSelectItem } from '../contracts';
import type { EditorRenderMutation } from '../contracts/render-mutation';

interface RenderEntity {
  readonly id: string;
}

interface RenderMutationIds {
  readonly ways?: readonly string[];
  readonly nodes?: readonly string[];
  readonly stops?: readonly string[];
  readonly stations?: readonly string[];
  readonly facilities?: readonly string[];
}

function changedRecords<RecordType extends RenderEntity>(
  previous: readonly RecordType[],
  next: readonly RecordType[],
  ids: readonly string[] | undefined,
  forcedIds: ReadonlySet<string>,
): RenderPreparationEntityPatch<RecordType> | undefined {
  if (!ids || ids.length === 0) return undefined;
  const requested = new Set(ids);
  const before = requestedRecords(previous, requested);
  const after = requestedRecords(next, requested);
  const upsert = changedUpserts(next, before, requested, forcedIds);
  const removeIds = removedIds(requested, before, after);
  return entityPatch(upsert, removeIds);
}

function requestedRecords<RecordType extends RenderEntity>(
  records: readonly RecordType[],
  requested: ReadonlySet<string>,
): ReadonlyMap<string, RecordType> {
  return new Map(
    records.filter((record) => requested.has(record.id)).map((record) => [record.id, record]),
  );
}

function changedUpserts<RecordType extends RenderEntity>(
  next: readonly RecordType[],
  before: ReadonlyMap<string, RecordType>,
  requested: ReadonlySet<string>,
  forcedIds: ReadonlySet<string>,
): RecordType[] {
  // Preserve collection order. Render source patches are easier to inspect and
  // deterministic when a local closure does not reorder its existing records.
  return next.filter(
    (record) =>
      requested.has(record.id) && (before.get(record.id) !== record || forcedIds.has(record.id)),
  );
}

function removedIds<RecordType extends RenderEntity>(
  requested: ReadonlySet<string>,
  before: ReadonlyMap<string, RecordType>,
  after: ReadonlyMap<string, RecordType>,
): string[] {
  return [...requested].filter((id) => before.has(id) && !after.has(id));
}

function entityPatch<RecordType extends RenderEntity>(
  upsert: readonly RecordType[],
  removeIds: readonly string[],
): RenderPreparationEntityPatch<RecordType> | undefined {
  return upsert.length > 0 || removeIds.length > 0
    ? {
        ...(upsert.length > 0 ? { upsert } : {}),
        ...(removeIds.length > 0 ? { removeIds } : {}),
      }
    : undefined;
}

function patchForIds(
  previous: TransitSystem,
  next: TransitSystem,
  ids: RenderMutationIds,
  force = {} as RenderMutationIds,
): RenderPreparationPatch {
  const forceIds = {
    ways: new Set(force.ways),
    nodes: new Set(force.nodes),
    stops: new Set(force.stops),
    stations: new Set(force.stations),
    facilities: new Set(force.facilities),
  };
  return {
    ways: changedRecords(previous.ways, next.ways, ids.ways, forceIds.ways),
    nodes: changedRecords(previous.nodes, next.nodes, ids.nodes, forceIds.nodes),
    stops: changedRecords(previous.stops, next.stops, ids.stops, forceIds.stops),
    stations: changedRecords(previous.stations, next.stations, ids.stations, forceIds.stations),
    facilities: changedRecords(
      previous.facilities,
      next.facilities,
      ids.facilities,
      forceIds.facilities,
    ),
  };
}

function wayGeometryIds(
  previous: TransitSystem,
  next: TransitSystem,
  wayIds: readonly string[],
): RenderMutationIds {
  const affectedWayIds = new Set(wayIds);
  const nodes = [...previous.nodes, ...next.nodes];
  for (const node of nodes) {
    if (node.refs.some((ref) => affectedWayIds.has(ref.wayId))) {
      for (const ref of node.refs) affectedWayIds.add(ref.wayId);
    }
  }
  const nodeIds = nodes
    .filter((node) => node.refs.some((ref) => affectedWayIds.has(ref.wayId)))
    .map((node) => node.id);
  const stopIds = [...previous.stops, ...next.stops]
    .filter((stop) => stop.anchors.some((anchor) => affectedWayIds.has(anchor.wayId)))
    .map((stop) => stop.id);
  return { ways: [...affectedWayIds], nodes: nodeIds, stops: stopIds };
}

/** Journals a physical way edit together with its junction and station effects. */
export function renderMutationForWayGeometry(...wayIds: string[]): EditorRenderMutation {
  return (previous, next) => patchForIds(previous, next, wayGeometryIds(previous, next, wayIds));
}

/** Includes a known topology neighbour even when its value is unchanged. */
export function renderMutationForWayJoin(...wayIds: string[]): EditorRenderMutation {
  return (previous, next) => {
    const ids = wayGeometryIds(previous, next, wayIds);
    return patchForIds(previous, next, ids, { ways: wayIds });
  };
}

/** Journals a way-only attribute edit without widening the renderer closure. */
export function renderMutationForWay(wayId: string): EditorRenderMutation {
  return (previous, next) => patchForIds(previous, next, { ways: [wayId] });
}

/** Journals the physical records a multi-selection nudge is allowed to move. */
export function renderMutationForSelection(
  items: readonly MultiSelectItem[],
): EditorRenderMutation {
  return (previous, next) => {
    const wayIds = items.filter((item) => item.kind === 'way').map((item) => item.id);
    const geometryIds = wayGeometryIds(previous, next, wayIds);
    return patchForIds(previous, next, {
      ...geometryIds,
      stops: [
        ...(geometryIds.stops ?? []),
        ...items.filter((item) => item.kind === 'stop').map((item) => item.id),
      ],
      stations: [
        ...(geometryIds.stations ?? []),
        ...items.filter((item) => item.kind === 'station').map((item) => item.id),
      ],
      facilities: items.filter((item) => item.kind === 'facility').map((item) => item.id),
    });
  };
}
