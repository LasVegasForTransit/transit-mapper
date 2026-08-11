import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import {
  createRenderPreparationCoordinator,
  type RenderPreparationPlan,
  type RenderPreparedSnapshot,
} from '../../src/render/render-preparation';
import {
  mergePreparedRenderInvalidations,
  planPreparedRenderProjectionScope,
} from '../../src/render/render-preparation-scope';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-1, -1], northeast: [2, 2] },
  zoom: 12,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  displayedWidthPx: 800,
  displayedHeightPx: 600,
  pixelRatio: 1,
};

function commit(
  coordinator: ReturnType<typeof createRenderPreparationCoordinator>,
  plan: RenderPreparationPlan,
): RenderPreparedSnapshot {
  for (let index = 0; index < plan.units.length; index++) {
    const unit = plan.units.unitAt?.(index) ?? plan.units[index];
    coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 1 });
  }
  const result = coordinator.commit(plan);
  if (result.kind !== 'committed') throw new Error(`Expected commit, received ${result.kind}`);
  return result.snapshot;
}

describe('prepared renderer projection ownership', () => {
  it('marks an unjournaled service rebuild as an explicit full projection', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({
      ways: [way],
      services: [aService('service', [aPattern('pattern', [way], [way.id])])],
    });
    const coordinator = createRenderPreparationCoordinator();
    const before = commit(
      coordinator,
      coordinator.plan({
        revision: 'before',
        system: previous,
        presentation: PRESENTATION,
        categories: ['corridor'],
      }),
    );
    const next = {
      ...previous,
      services: previous.services.map((service) => ({ ...service, color: '#123456' })),
    };
    const after = commit(
      coordinator,
      coordinator.plan({
        revision: 'after',
        system: next,
        presentation: PRESENTATION,
        categories: ['corridor'],
      }),
    );

    expect(after.fullProjectionReason).toBe('service-bundle-allocation');
    expect(planPreparedRenderProjectionScope(before, after)).toEqual({
      kind: 'full',
      reason: 'service-bundle-allocation',
    });
  });

  it('accepts an accumulated edit closure after a later camera preparation', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const coordinator = createRenderPreparationCoordinator();
    const live = commit(
      coordinator,
      coordinator.plan({
        revision: 'live',
        system: previous,
        presentation: PRESENTATION,
        categories: ['corridor'],
      }),
    );
    const edited = { ...way, grade: 'elevated' as const };
    const next = { ...previous, ways: [edited] };
    const edit = commit(
      coordinator,
      coordinator.plan({
        revision: 'edit',
        system: next,
        presentation: PRESENTATION,
        categories: ['corridor'],
        patch: { ways: { upsert: [edited] } },
      }),
    );
    const camera = commit(
      coordinator,
      coordinator.plan({
        revision: 'camera',
        system: next,
        presentation: { ...PRESENTATION, zoom: 13 },
        categories: ['corridor'],
      }),
    );
    const pending = mergePreparedRenderInvalidations(edit.invalidation, camera.invalidation);
    const projection = planPreparedRenderProjectionScope(live, camera, {
      invalidation: pending,
    });

    expect(projection.kind).toBe('scoped');
    if (projection.kind !== 'scoped') throw new Error('Expected accumulated scoped projection');
    expect(projection.scope.closure.corridorIds).toEqual(['way']);
    expect(projection.scope.replacement.physicalWayIds).toEqual(['way']);
  });
});
