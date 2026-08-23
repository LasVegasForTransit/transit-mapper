import type { Way } from '../model/system';
import type { ColdPlanContext } from './render-preparation-cold-types';
import {
  appendColdViewportGeometry,
  coldPreparedViewportCandidateBounds,
  recordColdViewportEntryCandidate,
  recordColdViewportEntryIdentity,
  reserveColdPreparedViewportEntries,
  reservePreparedViewportCandidates,
} from './render-preparation-viewport';
import { corridorViewportEntry } from './viewport-index-entries';
import {
  indexViewportSpatialEntryPathRange,
  viewportSpatialEntryPathRangeIntersectsNormalizedBounds,
} from './viewport-spatial-grid';

const CORRIDOR_POINT_CHUNK_SIZE = 64;

interface CorridorPointWorkIndex {
  readonly chunkEnds: number[];
  readonly entryIndices: number[];
  readonly candidateHits: boolean[];
  totalChunks: number;
  ready: boolean;
}

interface CorridorPointWork {
  readonly entryIndex: number;
  readonly segmentCount: number;
  readonly segmentStart: number;
  readonly segmentEnd: number;
}

function pointWorkAt(
  context: ColdPlanContext,
  work: CorridorPointWorkIndex,
  chunkIndex: number,
): CorridorPointWork | null {
  let low = 0;
  let high = work.chunkEnds.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (chunkIndex < work.chunkEnds[middle]) high = middle;
    else low = middle + 1;
  }
  if (low >= work.chunkEnds.length) return null;
  const priorEnd = low === 0 ? 0 : work.chunkEnds[low - 1];
  const segmentStart = (chunkIndex - priorEnd) * CORRIDOR_POINT_CHUNK_SIZE;
  const entryIndex = work.entryIndices[low];
  const entry = context.coldViewport.get('corridor')?.grid.entries[entryIndex];
  const segmentCount = Math.max(1, (entry?.paths[0]?.length ?? 1) - 1);
  return {
    entryIndex,
    segmentCount,
    segmentStart,
    segmentEnd: Math.min(segmentCount, segmentStart + CORRIDOR_POINT_CHUNK_SIZE),
  };
}

function addGeometry(
  context: ColdPlanContext,
  ways: readonly Way[],
  work: CorridorPointWorkIndex,
): void {
  const cold = context.coldViewport.get('corridor');
  if (!cold) return;
  context.builder.addUnitRange(
    Math.ceil(ways.length / context.chunkSize),
    'viewport-build',
    'geometry:corridor',
    (index) => Math.min(context.chunkSize, ways.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      const batch = ways.slice(start, start + context.chunkSize);
      for (const [offset, way] of batch.entries()) {
        const entry = corridorViewportEntry(way);
        appendColdViewportGeometry(cold, entry);
        const segmentCount = Math.max(1, (entry.paths[0]?.length ?? 1) - 1);
        if (segmentCount > CORRIDOR_POINT_CHUNK_SIZE) {
          work.totalChunks += Math.ceil(segmentCount / CORRIDOR_POINT_CHUNK_SIZE);
          work.entryIndices.push(start + offset);
          work.chunkEnds.push(work.totalChunks);
        }
      }
    },
  );
  context.builder.addUnit(
    'viewport-build',
    1,
    () => {
      work.ready = true;
    },
    'corridor-point-work-ready',
  );
}

function addMetadata(context: ColdPlanContext, ways: readonly Way[]): void {
  const cold = context.coldViewport.get('corridor');
  if (!cold) return;
  context.builder.addUnitRange(
    Math.ceil(ways.length / context.chunkSize),
    'viewport-build',
    'metadata:corridor',
    (index) => Math.min(context.chunkSize, ways.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      const batch = ways.slice(start, start + context.chunkSize);
      for (const [offset, way] of batch.entries()) {
        const entryIndex = start + offset;
        const entry = cold.grid.entries[entryIndex];
        recordColdViewportEntryIdentity({
          draft: context.viewport,
          category: 'corridor',
          ownerId: way.id,
          entry,
          generation: context.generation,
          cold,
        });
        const segmentCount = Math.max(1, (entry.paths[0]?.length ?? 1) - 1);
        if (segmentCount > CORRIDOR_POINT_CHUNK_SIZE) continue;
        const visible = viewportSpatialEntryPathRangeIntersectsNormalizedBounds({
          entry,
          pathIndex: 0,
          segmentStart: 0,
          segmentEnd: segmentCount,
          bounds: coldPreparedViewportCandidateBounds(
            cold,
            context.options.presentation,
            context.options.candidateEnvelope,
          ),
        });
        if (visible) {
          recordColdViewportEntryCandidate(context.viewport, 'corridor', entry, context.generation);
        }
        indexViewportSpatialEntryPathRange({
          draft: cold.grid,
          entryIndex,
          pathIndex: 0,
          segmentStart: 0,
          segmentEnd: segmentCount,
        });
      }
    },
  );
}

function addCandidateWork(context: ColdPlanContext, work: CorridorPointWorkIndex): void {
  const cold = context.coldViewport.get('corridor');
  if (!cold) return;
  context.builder.addDeferredUnitRange(
    () => (work.ready ? work.totalChunks : 1),
    'viewport-query',
    'candidate-exact:corridor',
    (index) => {
      const pointWork = pointWorkAt(context, work, index);
      return pointWork ? pointWork.segmentEnd - pointWork.segmentStart : 0;
    },
    (index) => {
      const pointWork = pointWorkAt(context, work, index);
      if (!pointWork) return;
      if (!work.candidateHits[pointWork.entryIndex]) {
        work.candidateHits[pointWork.entryIndex] =
          viewportSpatialEntryPathRangeIntersectsNormalizedBounds({
            entry: cold.grid.entries[pointWork.entryIndex],
            pathIndex: 0,
            segmentStart: pointWork.segmentStart,
            segmentEnd: pointWork.segmentEnd,
            bounds: coldPreparedViewportCandidateBounds(
              cold,
              context.options.presentation,
              context.options.candidateEnvelope,
            ),
          });
      }
      if (
        pointWork.segmentEnd >= pointWork.segmentCount &&
        work.candidateHits[pointWork.entryIndex]
      ) {
        recordColdViewportEntryCandidate(
          context.viewport,
          'corridor',
          cold.grid.entries[pointWork.entryIndex],
          context.generation,
        );
      }
    },
  );
}

function addSpatialWork(context: ColdPlanContext, work: CorridorPointWorkIndex): void {
  const cold = context.coldViewport.get('corridor');
  if (!cold) return;
  context.builder.addDeferredUnitRange(
    () => (work.ready ? work.totalChunks : 1),
    'viewport-build',
    'spatial:corridor',
    (index) => {
      const pointWork = pointWorkAt(context, work, index);
      return pointWork ? pointWork.segmentEnd - pointWork.segmentStart : 0;
    },
    (index) => {
      const pointWork = pointWorkAt(context, work, index);
      if (!pointWork) return;
      indexViewportSpatialEntryPathRange({
        draft: cold.grid,
        entryIndex: pointWork.entryIndex,
        pathIndex: 0,
        segmentStart: pointWork.segmentStart,
        segmentEnd: pointWork.segmentEnd,
      });
    },
  );
}

export function addColdCorridorViewportPlan(context: ColdPlanContext, ways: readonly Way[]): void {
  if (!context.categorySet.has('corridor')) return;
  const cold = context.coldViewport.get('corridor');
  if (!cold) return;
  reserveColdPreparedViewportEntries(cold, ways.length);
  reservePreparedViewportCandidates(context.viewport, 'corridor', ways.length);
  context.builder.runtime.operations.viewportEntityBuilds += ways.length;
  context.builder.runtime.operations.viewportSegmentQueries += ways.length * 2;
  const work: CorridorPointWorkIndex = {
    chunkEnds: [],
    entryIndices: [],
    candidateHits: [],
    totalChunks: 0,
    ready: false,
  };
  addGeometry(context, ways, work);
  addMetadata(context, ways);
  addCandidateWork(context, work);
  addSpatialWork(context, work);
}
