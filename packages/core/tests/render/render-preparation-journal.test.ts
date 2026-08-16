import { describe, expect, it } from 'vitest';
import {
  recordRenderPreparationPatch,
  renderPreparationPatchBetween,
} from '../../src/render/render-preparation-journal';
import {
  createRenderPreparationCoordinator,
  planJournaledRenderPreparation,
} from '../../src/render/render-preparation-update';
import { aRoad, aSystem } from '../support/fixtures.test';

describe('renderer preparation mutation journal', () => {
  it('returns the exact immutable entity delta recorded by a production mutation', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const edited = { ...way, grade: 'elevated' as const };
    const next = { ...previous, ways: [edited] };

    recordRenderPreparationPatch(previous, next, { ways: { upsert: [edited] } });

    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [edited] },
    });
  });

  it('composes consecutive edits from the same renderer baseline without scanning collections', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const baseline = aSystem({ ways: [way] });
    const moved = { ...way, points: [[0, 1], way.points[1]] as typeof way.points };
    const afterMove = { ...baseline, ways: [moved] };
    const elevated = { ...moved, grade: 'elevated' as const };
    const afterGrade = { ...afterMove, ways: [elevated] };
    recordRenderPreparationPatch(baseline, afterMove, { ways: { upsert: [moved] } });
    recordRenderPreparationPatch(afterMove, afterGrade, { ways: { upsert: [elevated] } });

    expect(renderPreparationPatchBetween(baseline, afterGrade)).toEqual({
      ways: { upsert: [elevated] },
    });
  });

  it('returns null for unjournaled imports, undo, and document replacement', () => {
    const previous = aSystem();
    const next = {
      ...previous,
      ways: [
        aRoad('imported', [
          [0, 0],
          [1, 0],
        ]),
      ],
    };

    expect(renderPreparationPatchBetween(previous, next)).toBeNull();
  });

  it('feeds a production journal delta into incremental preparation', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const coordinator = createRenderPreparationCoordinator();
    const presentation = {
      bounds: { southwest: [-1, -1] as [number, number], northeast: [2, 2] as [number, number] },
      zoom: 12,
      viewportWidthPx: 800,
      viewportHeightPx: 600,
      displayedWidthPx: 800,
      displayedHeightPx: 600,
      pixelRatio: 1,
    };
    const cold = planJournaledRenderPreparation(coordinator, {
      revision: 'before',
      previous,
      next: previous,
      presentation,
    });
    for (const unit of cold.units) {
      coordinator.record(cold, { unitId: unit.id, result: unit.run(), durationMs: 1 });
    }
    coordinator.commit(cold);
    const edited = { ...way, grade: 'elevated' as const };
    const next = { ...previous, ways: [edited] };
    recordRenderPreparationPatch(previous, next, { ways: { upsert: [edited] } });

    const update = planJournaledRenderPreparation(coordinator, {
      revision: 'after',
      previous,
      next,
      presentation,
    });

    expect(update.kind).toBe('incremental');
    expect(update.plannedOperations.domainEntityVisits).toBe(1);
  });
});
