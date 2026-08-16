import { expect, it } from 'vitest';
import { buildFeatures } from '../../src/render/buildFeatures';
import {
  resetDependencyIndexCacheDiagnostics,
  snapshotDependencyIndexCacheDiagnostics,
} from '../../src/render/dependency-index';
import {
  resetRenderDomainIndexCacheDiagnostics,
  snapshotRenderDomainIndexCacheDiagnostics,
} from '../../src/render/render-domain-indexes';
import {
  createRenderPreparationCoordinator,
  type RenderPreparationPlan,
} from '../../src/render/render-preparation';
import { planPreparedRenderProjectionScope } from '../../src/render/render-preparation-scope';
import type { RenderPresentation } from '../../src/render/render-presentation';
import {
  resetViewportIndexCacheDiagnostics,
  snapshotViewportIndexCacheDiagnostics,
} from '../../src/render/viewport-index';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-116, 35], northeast: [-114, 37] },
  zoom: 12,
  viewportWidthPx: 1440,
  viewportHeightPx: 900,
  displayedWidthPx: 1440,
  displayedHeightPx: 900,
  pixelRatio: 1,
};

function completePlan(
  coordinator: ReturnType<typeof createRenderPreparationCoordinator>,
  plan: RenderPreparationPlan,
): void {
  for (let index = 0; index < plan.units.length; index++) {
    const unit = plan.units.unitAt?.(index) ?? plan.units[index];
    coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 1 });
  }
}

function rtcRoads(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const west = -115.5 + (index % 128) * 0.003;
    const south = 35.9 + Math.floor(index / 128) * 0.003;
    return aRoad(`way-${index}`, [
      [west, south],
      [west + 0.002, south],
    ]);
  });
}

it('bypasses legacy whole-document indexes during prepared scoped projection', () => {
  const west = aRoad('west', [
    [-115.21, 36.1],
    [-115.2, 36.1],
  ]);
  const east = aRoad('east', [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ]);
  const previous = aSystem({
    ways: [west, east, ...rtcRoads(2_048)],
    nodes: [
      {
        id: 'junction',
        coord: [-115.2, 36.1],
        refs: [
          { wayId: 'west', pointIndex: 1 },
          { wayId: 'east', pointIndex: 0 },
        ],
      },
    ],
    services: [
      aService('main-service', [aPattern('main-pattern', [west, east], ['west', 'east'])]),
    ],
  });
  const coordinator = createRenderPreparationCoordinator();
  const cold = coordinator.plan({
    revision: 'prepared-before',
    system: previous,
    presentation: PRESENTATION,
    categories: ['corridor', 'junction', 'station', 'label'],
  });
  completePlan(coordinator, cold);
  const before = coordinator.commit(cold);
  if (before.kind !== 'committed') throw new Error('Expected prepared baseline');

  const edited = { ...west, grade: 'elevated' as const };
  const next = { ...previous, ways: [edited, ...previous.ways.slice(1)] };
  const update = coordinator.plan({
    revision: 'prepared-after',
    system: next,
    presentation: PRESENTATION,
    categories: ['corridor', 'junction', 'station', 'label'],
    patch: { ways: { upsert: [edited] } },
  });
  completePlan(coordinator, update);
  const after = coordinator.commit(update);
  if (after.kind !== 'committed') throw new Error('Expected prepared update');

  resetDependencyIndexCacheDiagnostics();
  resetViewportIndexCacheDiagnostics();
  resetRenderDomainIndexCacheDiagnostics();
  const projection = planPreparedRenderProjectionScope(before.snapshot, after.snapshot);
  expect(projection.kind).toBe('scoped');
  if (projection.kind !== 'scoped') throw new Error('Expected prepared scope');
  buildFeatures(
    next,
    null,
    [],
    {
      viewMode: 'infrastructure',
      visibleModes: new Set(['bus']),
      visibleWayTypes: new Set(['road']),
      presentation: PRESENTATION,
      styleDeferredVisibility: true,
    },
    null,
    null,
    { preparedSnapshot: after.snapshot, projectionScope: projection.scope },
  );

  expect(snapshotDependencyIndexCacheDiagnostics().buildCount).toBe(0);
  expect(snapshotViewportIndexCacheDiagnostics().buildCount).toBe(0);
  const diagnostics = snapshotRenderDomainIndexCacheDiagnostics();
  expect(
    diagnostics.nodes.buildCount +
      diagnostics.services.buildCount +
      diagnostics.stations.buildCount +
      diagnostics.namedWays.buildCount +
      diagnostics.facilities.buildCount +
      diagnostics.groups.buildCount,
  ).toBe(0);
});
