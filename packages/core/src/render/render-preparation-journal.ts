import type { TransitSystem } from '../model/system';
import type { RenderPreparationEntityPatch, RenderPreparationPatch } from './render-preparation';

interface JournalEntry {
  readonly previous: TransitSystem;
  readonly patch: RenderPreparationPatch;
}

const journal = new WeakMap<TransitSystem, JournalEntry>();
const MAX_COMPOSED_MUTATIONS = 256;

function mergeEntityPatch<T extends { id: string }>(
  earlier: RenderPreparationEntityPatch<T> | undefined,
  later: RenderPreparationEntityPatch<T> | undefined,
): RenderPreparationEntityPatch<T> | undefined {
  if (!earlier) return later;
  if (!later) return earlier;
  const upserts = new Map((earlier.upsert ?? []).map((value) => [value.id, value]));
  const removals = new Set(earlier.removeIds ?? []);
  for (const id of later.removeIds ?? []) {
    upserts.delete(id);
    removals.add(id);
  }
  for (const value of later.upsert ?? []) {
    removals.delete(value.id);
    upserts.set(value.id, value);
  }
  const upsert = [...upserts.values()];
  const removeIds = [...removals];
  if (upsert.length === 0 && removeIds.length === 0) return undefined;
  return {
    ...(upsert.length > 0 ? { upsert } : {}),
    ...(removeIds.length > 0 ? { removeIds } : {}),
  };
}

function mergePatches(
  earlier: RenderPreparationPatch,
  later: RenderPreparationPatch,
): RenderPreparationPatch {
  return {
    ways: mergeEntityPatch(earlier.ways, later.ways),
    nodes: mergeEntityPatch(earlier.nodes, later.nodes),
    services: mergeEntityPatch(earlier.services, later.services),
    stops: mergeEntityPatch(earlier.stops, later.stops),
    stations: mergeEntityPatch(earlier.stations, later.stations),
    namedWays: mergeEntityPatch(earlier.namedWays, later.namedWays),
    facilities: mergeEntityPatch(earlier.facilities, later.facilities),
    groups: mergeEntityPatch(earlier.groups, later.groups),
  };
}

function compactPatch(patch: RenderPreparationPatch): RenderPreparationPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, entityPatch]) => entityPatch !== undefined),
  );
}

/** Records an exact mutation delta at the point where changed objects are
 * already known. This is O(delta); it never rediscovers edits by comparing
 * immutable document arrays. */
export function recordRenderPreparationPatch(
  previous: TransitSystem,
  next: TransitSystem,
  patch: RenderPreparationPatch,
): TransitSystem {
  if (previous !== next) journal.set(next, { previous, patch: compactPatch(patch) });
  return next;
}

/** Composes a bounded chain of journaled gesture frames back to the renderer's
 * last committed immutable snapshot. Unjournaled bulk changes return null and
 * must use cooperative cold preparation. */
export function renderPreparationPatchBetween(
  previous: TransitSystem,
  next: TransitSystem,
): RenderPreparationPatch | null {
  if (previous === next) return {};
  let cursor = next;
  let composed: RenderPreparationPatch = {};
  for (let depth = 0; depth < MAX_COMPOSED_MUTATIONS; depth++) {
    const entry = journal.get(cursor);
    if (!entry) return null;
    composed = mergePatches(entry.patch, composed);
    if (entry.previous === previous) return compactPatch(composed);
    cursor = entry.previous;
  }
  return null;
}
