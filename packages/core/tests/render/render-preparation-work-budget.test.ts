import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import { createRenderPreparationCoordinator } from '../../src/render/render-preparation';
import { corridorViewportEntry } from '../../src/render/viewport-index-entries';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-116, 35], northeast: [-114, 37] },
  zoom: 12,
  viewportWidthPx: 1_440,
  viewportHeightPx: 900,
  displayedWidthPx: 1_440,
  displayedHeightPx: 900,
  pixelRatio: 1,
};

function detailedSystem(wayCount: number, pointsPerWay: number) {
  const ways = Array.from({ length: wayCount }, (_, wayIndex) =>
    aRoad(
      `way-${wayIndex}`,
      Array.from({ length: pointsPerWay }, (_, pointIndex) => [
        -115.5 + wayIndex * 0.001,
        36 + pointIndex * 0.000_01,
      ]),
    ),
  );
  return aSystem({
    ways,
    services: Array.from({ length: 5 }, (_, index) =>
      aService(`service-${index}`, [
        aPattern(
          `pattern-${index}`,
          ways,
          ways.map((way) => way.id),
        ),
      ]),
    ),
    stops: ways.map((way, index) => ({
      id: `stop-${index}`,
      name: `Stop ${index}`,
      coord: way.points[Math.floor(way.points.length / 2)],
      anchors: [{ wayId: way.id, t: 0.5 }],
    })),
  });
}

describe('renderer preparation work budgeting', () => {
  it('plans stop proximity without committed editor-handle work', () => {
    const coordinator = createRenderPreparationCoordinator();
    const plan = coordinator.plan({
      revision: 'bounded-cold',
      system: detailedSystem(128, 32),
      presentation: PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 4,
    });

    expect(plan.units.rangeCount).toBeLessThan(32);
    expect(plan.units.materializedCount?.()).toBe(0);
    // Stop membership reuses the corridor viewport grid. A second
    // city-wide segment index would duplicate cold work and can introduce a
    // large-map growth pause inside an otherwise one-entity unit.
    expect(plan.units.some(({ id }) => id.includes('proximity-grid'))).toBe(false);
    expect(plan.units.some(({ label }) => label === 'stop-proximity')).toBe(true);
    expect(plan.units.some(({ id }) => id.includes('geometry:corridor'))).toBe(true);
    expect(plan.units.some(({ id }) => id.includes('metadata:corridor'))).toBe(true);
    expect(plan.units.some(({ id }) => id.includes('spatial:corridor'))).toBe(true);
    expect(plan.units.some(({ id }) => id.includes('index:corridor'))).toBe(false);
    expect(plan.units.some(({ id }) => id.includes('way-handle'))).toBe(false);
    expect(plan.units.some(({ id }) => id.includes('physical-handle'))).toBe(false);
    expect(plan.units.some(({ id }) => id.includes('service-terminus'))).toBe(false);
    // Cold preparation uses the caller's four-entity batch size for every
    // entity collection. Leaving corridor and stop work one entity at a time
    // turns a large document into thousands of scheduler hand-offs.
    for (const [label, count] of [
      ['geometry:corridor', 32],
      ['metadata:corridor', 32],
      ['service-dependencies-and-bundle', 2],
      ['stop-proximity', 32],
    ] as const) {
      const units = plan.units.filter((unit) => unit.label === label);
      expect(units.length).toBe(count);
      expect(units.every(({ operationCount }) => operationCount <= 4)).toBe(true);
    }
    expect(
      plan.units.some(
        ({ id, operationCount }) => id.includes('stop-proximity') && operationCount > 4,
      ),
    ).toBe(false);
    expect(
      plan.units.some(({ id }) => id.includes('viewport-state') && id.includes('merge-all')),
    ).toBe(false);
    expect(plan.plannedOperations.viewportEntityBuilds).toBe(256);

    for (let index = 0; index < plan.units.length; index++) {
      const unit = plan.units.unitAt?.(index) ?? plan.units[index];
      coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 1 });
    }
    const result = coordinator.commit(plan);
    expect(plan.units.materializedCount?.()).toBeLessThanOrEqual(2);
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Expected committed preparation');
    expect(result.snapshot.categories).toEqual([
      'corridor',
      'junction',
      'stop',
      'station',
      'label',
      'facility',
      'group',
    ]);
    expect(result.snapshot.candidates).toMatchObject({
      wayHandleIds: undefined,
      serviceTerminusIds: undefined,
      physicalHandleIds: undefined,
    });
    expect(result.snapshot.wayIdsByStop.get('stop-0')).toContain('way-0');
  });

  it('refines one long imported corridor by point work below the unit ceiling', () => {
    const longWay = aRoad(
      'long-way',
      Array.from({ length: 8_192 }, (_, index) => [
        -120 + index * 0.000_01,
        40 + Math.sin(index * 0.17) * 0.001,
      ]),
    );
    const coordinator = createRenderPreparationCoordinator();
    expect(corridorViewportEntry(longWay).paths[0]).toBe(longWay.points);
    const plan = coordinator.plan({
      revision: 'long-way',
      system: aSystem({ ways: [longWay] }),
      presentation: PRESENTATION,
      categories: ['corridor'],
      entityChunkSize: 1,
    });

    for (let index = 0; index < plan.units.length; index++) {
      const unit = plan.units.unitAt?.(index) ?? plan.units[index];
      coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 1 });
    }

    const pointUnits = plan.units.filter(
      ({ label }) => label === 'candidate-exact:corridor' || label === 'spatial:corridor',
    );
    expect(pointUnits.length).toBeGreaterThan(200);
    expect(pointUnits.every(({ operationCount }) => operationCount <= 64)).toBe(true);
    expect(coordinator.commit(plan).kind).toBe('committed');
  });
});
