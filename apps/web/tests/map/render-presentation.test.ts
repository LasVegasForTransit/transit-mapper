import { describe, expect, it } from 'vitest';
import {
  CorridorTierRegistry,
  displayedCorridorWidthPx,
  renderPresentationFromMap,
  type MapRenderPresentationInput,
} from '../../src/map/render-presentation';

const MPP_Z14_EQUATOR = 40075016.686 / (512 * 2 ** 14);

function widthMetersAtZ14(widthPx: number): number {
  return widthPx * MPP_Z14_EQUATOR;
}

function mapInput(overrides: Partial<MapRenderPresentationInput> = {}): MapRenderPresentationInput {
  return {
    bounds: {
      getSouthWest: () => ({ lng: -115.25, lat: 36.05 }),
      getNorthEast: () => ({ lng: -115.05, lat: 36.25 }),
    },
    zoom: 14,
    viewportWidthPx: 1200,
    viewportHeightPx: 600,
    displayedWidthPx: 1200,
    displayedHeightPx: 600,
    pixelRatio: 1,
    ...overrides,
  };
}

describe('web render presentation', () => {
  it('adapts MapLibre-style camera facts to the core presentation contract', () => {
    const result = renderPresentationFromMap(
      mapInput({
        zoom: 12.75,
        viewportWidthPx: 1440,
        viewportHeightPx: 900,
        displayedWidthPx: 720,
        displayedHeightPx: 450,
        pixelRatio: 3,
      }),
    );

    expect(result).toEqual({
      bounds: {
        southwest: [-115.25, 36.05],
        northeast: [-115.05, 36.25],
      },
      zoom: 12.75,
      viewportWidthPx: 1440,
      viewportHeightPx: 900,
      displayedWidthPx: 720,
      displayedHeightPx: 450,
      pixelRatio: 3,
    });
  });

  it('keeps metric corridor LOD independent of backing-store pixel ratio', () => {
    const oneX = renderPresentationFromMap(mapInput({ pixelRatio: 1 }));
    const threeX = renderPresentationFromMap(mapInput({ pixelRatio: 3 }));
    const widthM = widthMetersAtZ14(3);

    expect(displayedCorridorWidthPx(widthM, 0, oneX)).toBeCloseTo(3);
    expect(displayedCorridorWidthPx(widthM, 0, threeX)).toBeCloseTo(3);

    const oneXRegistry = new CorridorTierRegistry();
    const threeXRegistry = new CorridorTierRegistry();
    expect(
      oneXRegistry.resolve({ corridorId: 'road', widthM, latitude: 0, presentation: oneX }).tier,
    ).toBe('district');
    expect(
      threeXRegistry.resolve({
        corridorId: 'road',
        widthM,
        latitude: 0,
        presentation: threeX,
      }).tier,
    ).toBe('district');
  });

  it('uses fractional zoom and final display scale for projected corridor width', () => {
    const presentation = renderPresentationFromMap(
      mapInput({
        zoom: 15,
        displayedWidthPx: 600,
        displayedHeightPx: 300,
      }),
    );

    expect(displayedCorridorWidthPx(widthMetersAtZ14(3), 0, presentation)).toBeCloseTo(3);
  });

  it('uses the limiting display axis for a proportionally contained result', () => {
    const presentation = renderPresentationFromMap(
      mapInput({
        displayedWidthPx: 900,
        displayedHeightPx: 300,
      }),
    );

    expect(displayedCorridorWidthPx(widthMetersAtZ14(6), 0, presentation)).toBeCloseTo(3);
  });

  it('retains District and Street by stable corridor identity', () => {
    const presentation = renderPresentationFromMap(mapInput());
    const registry = new CorridorTierRegistry();

    expect(
      registry.resolve({
        corridorId: 'district-road',
        widthM: widthMetersAtZ14(3),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('district');
    expect(
      registry.resolve({
        corridorId: 'district-road',
        widthM: widthMetersAtZ14(2.5),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('district');
    expect(
      registry.resolve({
        corridorId: 'unseen-road',
        widthM: widthMetersAtZ14(2.5),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('overview');

    expect(
      registry.resolve({
        corridorId: 'street-road',
        widthM: widthMetersAtZ14(12),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('street');
    expect(
      registry.resolve({
        corridorId: 'street-road',
        widthM: widthMetersAtZ14(9),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('street');
    expect(
      registry.resolve({
        corridorId: 'street-road',
        widthM: widthMetersAtZ14(8.99),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('district');
  });

  it('keeps blend weights deterministic when hysteresis retains a different logical tier', () => {
    const presentation = renderPresentationFromMap(mapInput());
    const registry = new CorridorTierRegistry();
    registry.resolve({
      corridorId: 'retained',
      widthM: widthMetersAtZ14(3),
      latitude: 0,
      presentation,
    });

    const retained = registry.resolve({
      corridorId: 'retained',
      widthM: widthMetersAtZ14(2.5),
      latitude: 0,
      presentation,
    });
    const fresh = registry.resolve({
      corridorId: 'fresh',
      widthM: widthMetersAtZ14(2.5),
      latitude: 0,
      presentation,
    });

    expect(retained.tier).toBe('district');
    expect(fresh.tier).toBe('overview');
    expect(retained.blend).toEqual(fresh.blend);
    expect(retained.blend.weights).toEqual({ overview: 0.75, district: 0.25, street: 0 });
  });

  it('resets one corridor or the complete live hysteresis history', () => {
    const presentation = renderPresentationFromMap(mapInput());
    const registry = new CorridorTierRegistry();
    for (const corridorId of ['first', 'second']) {
      registry.resolve({
        corridorId,
        widthM: widthMetersAtZ14(3),
        latitude: 0,
        presentation,
      });
    }

    registry.reset('first');
    expect(
      registry.resolve({
        corridorId: 'first',
        widthM: widthMetersAtZ14(2.5),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('overview');
    expect(
      registry.resolve({
        corridorId: 'second',
        widthM: widthMetersAtZ14(2.5),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('district');

    registry.reset();
    expect(
      registry.resolve({
        corridorId: 'second',
        widthM: widthMetersAtZ14(2.5),
        latitude: 0,
        presentation,
      }).tier,
    ).toBe('overview');
  });
});
