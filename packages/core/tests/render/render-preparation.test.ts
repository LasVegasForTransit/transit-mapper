import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import {
  createRenderPreparationCoordinator,
  type RenderPreparationPlan,
  type RenderPreparationUnitMeasurement,
} from '../../src/render/render-preparation';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const WIDE_PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-116, 35], northeast: [-114, 37] },
  zoom: 12,
  viewportWidthPx: 1440,
  viewportHeightPx: 900,
  displayedWidthPx: 1440,
  displayedHeightPx: 900,
  pixelRatio: 1,
};

const NARROW_PRESENTATION: RenderPresentation = {
  ...WIDE_PRESENTATION,
  bounds: { southwest: [-115.21, 36.09], northeast: [-115.19, 36.11] },
};

function completePlan(
  coordinator: ReturnType<typeof createRenderPreparationCoordinator>,
  plan: RenderPreparationPlan,
  durationFor: (unitIndex: number) => number = () => 1,
): void {
  for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex++) {
    const unit = plan.units[unitIndex];
    const measurement: RenderPreparationUnitMeasurement = {
      unitId: unit.id,
      result: unit.run(),
      durationMs: durationFor(unitIndex),
    };
    coordinator.record(plan, measurement);
  }
}

function rtcShapedSystem(wayCount = 4_096) {
  const ways = Array.from({ length: wayCount }, (_, index) => {
    const column = index % 128;
    const row = Math.floor(index / 128);
    const west = -115.5 + column * 0.003;
    const south = 35.9 + row * 0.003;
    return aRoad(`way-${index}`, [
      [west, south],
      [west + 0.002, south],
    ]);
  });
  return aSystem({ ways });
}

describe('renderer preparation coordinator', () => {
  it('chunks an RTC-shaped cold index and reuses it for a camera-only update', () => {
    const system = rtcShapedSystem();
    const coordinator = createRenderPreparationCoordinator({ maxUnitDurationMs: 4 });
    const cold = coordinator.plan({
      revision: 'rtc-1',
      system,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 32,
    });

    expect(cold.kind).toBe('cold');
    expect(cold.plannedOperations).toMatchObject({
      domainEntityVisits: 4_096,
      viewportEntityBuilds: 4_096,
    });
    expect(cold.units.length).toBeGreaterThan(100);
    expect(
      cold.units
        .filter((unit) => unit.stage !== 'finalize')
        .every((unit) => unit.operationCount <= 32),
    ).toBe(true);

    completePlan(coordinator, cold);
    const committed = coordinator.commit(cold);
    expect(committed.kind).toBe('committed');
    if (committed.kind !== 'committed') throw new Error('Expected cold preparation to commit');
    expect(committed.snapshot.candidates.wayIds).toHaveLength(4_096);
    expect(committed.snapshot.diagnostics).toMatchObject({
      kind: 'cold',
      domainEntityVisits: 4_096,
      viewportEntityBuilds: 4_096,
      maxMeasuredUnitDurationMs: 1,
    });

    const pan = coordinator.plan({
      revision: 'rtc-1-camera-2',
      system,
      presentation: NARROW_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 32,
    });

    expect(pan.kind).toBe('camera');
    expect(pan.plannedOperations.domainEntityVisits).toBe(0);
    expect(pan.plannedOperations.viewportEntityBuilds).toBe(0);
    completePlan(coordinator, pan);
    const panned = coordinator.commit(pan);
    expect(panned.kind).toBe('committed');
    if (panned.kind !== 'committed') throw new Error('Expected camera preparation to commit');
    expect(panned.snapshot.diagnostics).toMatchObject({
      kind: 'camera',
      domainEntityVisits: 0,
      viewportEntityBuilds: 0,
    });
    expect(panned.snapshot.candidates.wayIds?.length).toBeLessThan(4_096);

    const sweptPan = coordinator.plan({
      revision: 'rtc-1-camera-swept',
      system,
      presentation: NARROW_PRESENTATION,
      candidateEnvelope: { bounds: WIDE_PRESENTATION.bounds },
      categories: ['corridor'],
      entityChunkSize: 32,
    });
    completePlan(coordinator, sweptPan);
    const swept = coordinator.commit(sweptPan);
    expect(swept.kind).toBe('committed');
    if (swept.kind !== 'committed') throw new Error('Expected swept camera preparation to commit');
    expect(swept.snapshot.presentation).toBe(NARROW_PRESENTATION);
    expect(swept.snapshot.candidates.wayIds).toHaveLength(4_096);
  });

  it('updates one corridor and its dependency closure without rebuilding document maps', () => {
    const unrelated = rtcShapedSystem(2_048).ways;
    const west = aRoad('west', [
      [-115.21, 36.1],
      [-115.2, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const service = aService('main-service', [
      aPattern('main-pattern', [west, east], ['west', 'east']),
    ]);
    const previous = aSystem({
      ways: [west, east, ...unrelated],
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
      services: [service],
      namedWays: [{ id: 'main-name', name: 'Main Street', wayIds: ['west', 'east'] }],
    });
    const coordinator = createRenderPreparationCoordinator();
    const cold = coordinator.plan({
      revision: 'before',
      system: previous,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor', 'junction', 'label', 'service-terminus'],
      entityChunkSize: 32,
    });
    completePlan(coordinator, cold);
    const coldResult = coordinator.commit(cold);
    expect(coldResult.kind).toBe('committed');
    if (coldResult.kind !== 'committed') throw new Error('Expected cold preparation to commit');

    const editedWest = {
      ...west,
      points: [[-115.211, 36.101], west.points[1]] as typeof west.points,
    };
    const next = {
      ...previous,
      ways: previous.ways.map((way) => (way.id === 'west' ? editedWest : way)),
    };
    const update = coordinator.plan({
      revision: 'after',
      system: next,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor', 'junction', 'label', 'service-terminus'],
      patch: { ways: { upsert: [editedWest] } },
      entityChunkSize: 32,
    });

    expect(update.kind).toBe('incremental');
    expect(update.plannedOperations).toMatchObject({
      domainEntityVisits: 1,
      viewportEntityBuilds: 2,
      viewportSegmentQueries: 2,
    });
    expect(update.plannedOperations.domainEntityVisits).toBeLessThan(previous.ways.length / 100);
    const candidateUnits = update.units.filter(({ label }) => label.startsWith('candidate-'));
    expect(candidateUnits.length).toBeGreaterThan(1);
    expect(candidateUnits.every(({ operationCount }) => operationCount <= 256)).toBe(true);

    completePlan(coordinator, update);
    const updated = coordinator.commit(update);
    expect(updated.kind).toBe('committed');
    if (updated.kind !== 'committed') throw new Error('Expected incremental preparation to commit');
    expect(updated.snapshot.waysById.get('west')).toBe(editedWest);
    expect(updated.snapshot.waysById.get('east')).toBe(east);
    expect(updated.snapshot.candidates.wayIds).toHaveLength(previous.ways.length);
    expect(updated.snapshot.invalidation).toMatchObject({
      corridorIds: ['west', 'east'],
      junctionIds: ['junction'],
      connectorJunctionIds: ['junction'],
      stationIds: [],
    });
    expect(updated.snapshot.invalidation.serviceSpanIds).toHaveLength(2);
    expect(updated.snapshot.invalidation.labelIds).toHaveLength(1);
  });

  it('removes prior viewport and dependency identities through an explicit delta', () => {
    const west = aRoad('west', [
      [-115.21, 36.1],
      [-115.2, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const previous = aSystem({
      ways: [west, east],
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
    });
    const coordinator = createRenderPreparationCoordinator();
    const cold = coordinator.plan({
      revision: 'before-removal',
      system: previous,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
    });
    completePlan(coordinator, cold);
    coordinator.commit(cold);
    const next = { ...previous, ways: [east] };
    const removal = coordinator.plan({
      revision: 'after-removal',
      system: next,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      patch: { ways: { removeIds: ['west'] } },
    });

    completePlan(coordinator, removal);
    const removed = coordinator.commit(removal);
    expect(removed.kind).toBe('committed');
    if (removed.kind !== 'committed') throw new Error('Expected removal to commit');
    expect(removed.snapshot.waysById.has('west')).toBe(false);
    expect(removed.snapshot.candidates.wayIds).toEqual(['east']);
    expect(removed.snapshot.invalidation.corridorIds).toEqual(['west', 'east']);
    expect(removed.snapshot.invalidation.junctionIds).toEqual(['junction']);
  });

  it('keeps the previous snapshot when a measured unit exceeds its budget', () => {
    const system = rtcShapedSystem(32);
    const coordinator = createRenderPreparationCoordinator({ maxUnitDurationMs: 4 });
    const cold = coordinator.plan({
      revision: 'stable',
      system,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 8,
    });
    completePlan(coordinator, cold);
    const stable = coordinator.commit(cold);
    expect(stable.kind).toBe('committed');
    if (stable.kind !== 'committed') throw new Error('Expected stable snapshot');

    const edited = {
      ...system.ways[0],
      points: [[-115.7, 35.7], system.ways[0].points[1]] as (typeof system.ways)[0]['points'],
    };
    const next = { ...system, ways: [edited, ...system.ways.slice(1)] };
    const update = coordinator.plan({
      revision: 'too-slow',
      system: next,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      patch: { ways: { upsert: [edited] } },
    });
    completePlan(coordinator, update, (unitIndex) => (unitIndex === 0 ? 4.01 : 1));
    const failed = coordinator.commit(update);

    expect(failed).toMatchObject({ kind: 'budget-exceeded', limitMs: 4, measuredMs: 4.01 });
    expect(coordinator.current()).toBe(stable.snapshot);
  });

  it('publishes a complete minimal plan while retaining its overrun diagnostic', () => {
    const system = rtcShapedSystem(8);
    const coordinator = createRenderPreparationCoordinator({ maxUnitDurationMs: 4 });
    const plan = coordinator.plan({
      revision: 'minimal-overrun',
      system,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 1,
    });

    for (let index = 0; index < plan.units.length; index += 1) {
      const unit = plan.units[index];
      coordinator.record(
        plan,
        { unitId: unit.id, result: unit.run(), durationMs: index === 0 ? 7 : 1 },
        { tolerateBudgetOverrun: true },
      );
    }

    const committed = coordinator.commit(plan);
    expect(committed.kind).toBe('committed');
    if (committed.kind !== 'committed') throw new Error('Expected minimal plan to commit.');
    expect(committed.snapshot.diagnostics.maxMeasuredUnitDurationMs).toBe(7);
  });

  it('rejects stale generations before their remaining preparation work runs', () => {
    const system = rtcShapedSystem(64);
    const coordinator = createRenderPreparationCoordinator();
    const first = coordinator.plan({
      revision: 'generation-1',
      system,
      presentation: WIDE_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 8,
    });
    const second = coordinator.plan({
      revision: 'generation-2',
      system,
      presentation: NARROW_PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 8,
    });

    expect(first.units[0].run()).toEqual({ kind: 'stale' });
    expect(coordinator.commit(first)).toEqual({
      kind: 'stale',
      generation: first.generation,
    });
    completePlan(coordinator, second);
    const committed = coordinator.commit(second);
    expect(committed.kind).toBe('committed');
    if (committed.kind !== 'committed') throw new Error('Expected latest generation to commit');
    expect(coordinator.current()).toBe(committed.snapshot);
  });
});
