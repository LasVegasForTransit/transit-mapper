import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { serviceFocusOpacityExpr, tierOpacityExpr } from '../../src/map/layers/constants';
import { createLayerSpecs } from '../../src/map/layers/layerSpecs';
import { MAP_THEMES } from '../../src/map/mapThemePalette';

interface CompiledStyleExpression {
  evaluate(
    globals: { zoom: number },
    feature: { type: 'LineString'; properties: Record<string, unknown> },
    featureState?: Record<string, unknown>,
  ): unknown;
}

interface StyleExpressionRuntime {
  createExpression(expression: unknown): unknown;
  validateStyleMin(style: unknown): unknown;
}

interface CompiledExpressionResult {
  result: 'success';
  value: CompiledStyleExpression;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStyleExpressionRuntime(value: unknown): value is StyleExpressionRuntime {
  return (
    isRecord(value) &&
    typeof value.createExpression === 'function' &&
    typeof value.validateStyleMin === 'function'
  );
}

function isCompiledExpressionResult(value: unknown): value is CompiledExpressionResult {
  return (
    isRecord(value) &&
    value.result === 'success' &&
    isRecord(value.value) &&
    typeof value.value.evaluate === 'function'
  );
}

const appRequire = createRequire(import.meta.url);
const mapLibreRequire = createRequire(appRequire.resolve('maplibre-gl'));
const loadedRuntime = mapLibreRequire('@maplibre/maplibre-gl-style-spec') as unknown;
if (!isStyleExpressionRuntime(loadedRuntime)) {
  throw new Error('MapLibre style expression runtime is unavailable');
}
const styleRuntime: StyleExpressionRuntime = loadedRuntime;

function compileStyleExpression(expression: unknown): CompiledStyleExpression {
  const result = styleRuntime.createExpression(expression);
  if (!isCompiledExpressionResult(result)) {
    throw new Error(`MapLibre rejected expression: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function styleValidationMessages(style: unknown): string[] {
  const result = styleRuntime.validateStyleMin(style);
  if (!Array.isArray(result)) throw new Error('MapLibre style validator returned no error list');
  return result.map((error: unknown) => {
    if (!isRecord(error) || typeof error.message !== 'string') {
      throw new Error('MapLibre style validator returned an invalid error');
    }
    return error.message;
  });
}

const BASE_TIER_OPACITY = compileStyleExpression(tierOpacityExpr(1));
type RenderTier = 'overview' | 'district' | 'street';

interface TierAvailability {
  overview: boolean;
  district: boolean;
  street: boolean;
}

interface TierOpacityEvaluation {
  tier: RenderTier;
  corridorW14: number;
  corridorDisplayW14?: number;
  zoom: number;
  availability: TierAvailability;
  expression?: CompiledStyleExpression;
  featureState?: Record<string, unknown>;
}

function evaluateExpression(
  expression: CompiledStyleExpression,
  zoom: number,
  properties: Record<string, unknown>,
  featureState: Record<string, unknown> = {},
): number {
  const value = expression.evaluate({ zoom }, { type: 'LineString', properties }, featureState);
  if (typeof value !== 'number') throw new Error('tier opacity did not evaluate to a number');
  return value;
}

function evaluateTierOpacity({
  tier,
  corridorW14,
  corridorDisplayW14,
  zoom,
  availability,
  expression = BASE_TIER_OPACITY,
  featureState,
}: TierOpacityEvaluation): number {
  return evaluateExpression(
    expression,
    zoom,
    {
      renderTier: tier,
      corridorW14,
      ...(corridorDisplayW14 === undefined ? {} : { corridorDisplayW14 }),
      projectedWidthPx: corridorW14,
      hasOverviewTier: availability.overview,
      hasDistrictTier: availability.district,
      hasStreetTier: availability.street,
      tierOpacity: 0.25,
    },
    featureState,
  );
}

const ALL_TIERS: TierAvailability = { overview: true, district: true, street: true };

function sourceOverAlpha(lowerOpacity: number, upperOpacity: number): number {
  return upperOpacity + lowerOpacity * (1 - upperOpacity);
}

function lowerBandAt(zoom: number) {
  return {
    overview: evaluateTierOpacity({
      tier: 'overview',
      corridorW14: 2,
      zoom,
      availability: ALL_TIERS,
    }),
    district: evaluateTierOpacity({
      tier: 'district',
      corridorW14: 2,
      zoom,
      availability: ALL_TIERS,
    }),
  };
}

function upperBandAt(zoom: number) {
  return {
    district: evaluateTierOpacity({
      tier: 'district',
      corridorW14: 9,
      zoom,
      availability: ALL_TIERS,
    }),
    street: evaluateTierOpacity({
      tier: 'street',
      corridorW14: 9,
      zoom,
      availability: ALL_TIERS,
    }),
  };
}

describe('tier opacity during camera and source-patch gaps', () => {
  it('uses the final displayed scale for static MapLibre surfaces', () => {
    const scaled = evaluateTierOpacity({
      tier: 'district',
      corridorW14: 6,
      corridorDisplayW14: 3,
      zoom: 14,
      availability: ALL_TIERS,
    });
    const equivalentUnscaled = evaluateTierOpacity({
      tier: 'district',
      corridorW14: 3,
      zoom: 14,
      availability: ALL_TIERS,
    });

    expect(scaled).toBeCloseTo(equivalentUnscaled, 8);
    expect(scaled).toBeCloseTo(0.5, 8);
  });

  it('cross-fades adjacent tiers in both zoom directions across both bands', () => {
    const lowerZoomIn = [14, 14.5, 15].map(lowerBandAt);
    expect(lowerZoomIn[0]).toEqual({ overview: 1, district: 0 });
    expect(lowerZoomIn[1]?.overview).toBe(1);
    expect(lowerZoomIn[1]?.district).toBeCloseTo(Math.SQRT2 - 1, 8);
    expect(lowerZoomIn[2]).toEqual({ overview: 0, district: 1 });
    expect([15, 14.5, 14].map(lowerBandAt)).toEqual([...lowerZoomIn].reverse());

    const upperZoomIn = [14, 14.25, 14.5].map(upperBandAt);
    expect(upperZoomIn[0]).toEqual({ district: 1, street: 0 });
    expect(upperZoomIn[1]?.district).toBe(1);
    expect(upperZoomIn[1]?.street).toBeGreaterThan(0);
    expect(upperZoomIn[1]?.street).toBeLessThan(1);
    expect(upperZoomIn[2]).toEqual({ district: 0, street: 1 });
    expect([14.5, 14.25, 14].map(upperBandAt)).toEqual([...upperZoomIn].reverse());
  });

  it('allocates alpha by paint order without a midpoint brightness trough', () => {
    const baseOpacity = 0.85;
    const expression = compileStyleExpression(tierOpacityExpr(baseOpacity));
    for (const width of [2, 2.25, 2.5, 3, 3.5, 3.75, 4]) {
      const lower = evaluateTierOpacity({
        tier: 'overview',
        corridorW14: width,
        zoom: 14,
        availability: ALL_TIERS,
        expression,
      });
      const upper = evaluateTierOpacity({
        tier: 'district',
        corridorW14: width,
        zoom: 14,
        availability: ALL_TIERS,
        expression,
      });
      expect(sourceOverAlpha(lower, upper), `Overview/District at ${width}px`).toBeCloseTo(
        baseOpacity,
        8,
      );
    }

    for (const width of [9, 9.5, 10, 10.5, 11, 11.5, 12]) {
      const lower = evaluateTierOpacity({
        tier: 'district',
        corridorW14: width,
        zoom: 14,
        availability: ALL_TIERS,
        expression,
      });
      const upper = evaluateTierOpacity({
        tier: 'street',
        corridorW14: width,
        zoom: 14,
        availability: ALL_TIERS,
        expression,
      });
      expect(sourceOverAlpha(lower, upper), `District/Street at ${width}px`).toBeCloseTo(
        baseOpacity,
        8,
      );
    }

    for (const zoom of [13.875, 14.125, 14.375]) {
      const corridorW14 = 3 / 2 ** (zoom - 14);
      const lower = evaluateTierOpacity({
        tier: 'overview',
        corridorW14,
        zoom,
        availability: ALL_TIERS,
        expression,
      });
      const upper = evaluateTierOpacity({
        tier: 'district',
        corridorW14,
        zoom,
        availability: ALL_TIERS,
        expression,
      });
      expect(
        Math.abs(sourceOverAlpha(lower, upper) - baseOpacity),
        `fractional zoom ${zoom}`,
      ).toBeLessThan(0.007);
    }
  });

  it('holds the last uploaded tier until the missing adjacent tier arrives', () => {
    for (const scenario of [
      { tier: 'overview', corridorW14: 2, zoom: 17, availability: [true, false, false] },
      { tier: 'district', corridorW14: 6, zoom: 11, availability: [false, true, false] },
      { tier: 'district', corridorW14: 6, zoom: 16, availability: [false, true, false] },
      { tier: 'street', corridorW14: 12, zoom: 11, availability: [false, false, true] },
    ] as const) {
      const [overview, district, street] = scenario.availability;
      expect(
        evaluateTierOpacity({
          tier: scenario.tier,
          corridorW14: scenario.corridorW14,
          zoom: scenario.zoom,
          availability: { overview, district, street },
        }),
      ).toBe(1);
    }
  });

  it('uses deterministic blends as soon as each adjacent tier is available', () => {
    const lower = { overview: true, district: true, street: false };
    expect(
      evaluateTierOpacity({ tier: 'overview', corridorW14: 3, zoom: 14, availability: lower }),
    ).toBe(1);
    expect(
      evaluateTierOpacity({ tier: 'district', corridorW14: 3, zoom: 14, availability: lower }),
    ).toBeCloseTo(0.5, 8);

    const upper = { overview: false, district: true, street: true };
    expect(
      evaluateTierOpacity({ tier: 'district', corridorW14: 10.5, zoom: 14, availability: upper }),
    ).toBe(1);
    expect(
      evaluateTierOpacity({ tier: 'street', corridorW14: 10.5, zoom: 14, availability: upper }),
    ).toBeCloseTo(0.5, 8);
  });

  it('evaluates fractional zoom continuously while adjacent tiers are available', () => {
    const zoom = 14.125;
    const lowerWidth = 2.5 * 2 ** (zoom - 14);
    const lowerDistrict = evaluateTierOpacity({
      tier: 'district',
      corridorW14: 2.5,
      zoom,
      availability: ALL_TIERS,
    });
    expect(lowerDistrict).toBeCloseTo((lowerWidth - 2) / 2, 8);
    expect(
      evaluateTierOpacity({
        tier: 'overview',
        corridorW14: 2.5,
        zoom,
        availability: ALL_TIERS,
      }),
    ).toBe(1);

    const upperWidth = 10 * 2 ** (zoom - 14);
    const upperStreet = evaluateTierOpacity({
      tier: 'street',
      corridorW14: 10,
      zoom,
      availability: ALL_TIERS,
    });
    expect(upperStreet).toBeCloseTo((upperWidth - 9) / 3, 8);
    expect(
      evaluateTierOpacity({
        tier: 'district',
        corridorW14: 10,
        zoom,
        availability: ALL_TIERS,
      }),
    ).toBe(1);
  });

  it('preserves legacy deterministic and stamped-opacity fallbacks', () => {
    expect(
      evaluateExpression(BASE_TIER_OPACITY, 14, {
        renderTier: 'district',
        corridorW14: 3,
        tierOpacity: 0.25,
      }),
    ).toBeCloseTo(0.5, 8);
    expect(evaluateExpression(BASE_TIER_OPACITY, 18.5, { tierOpacity: 0.375 })).toBe(0.375);
  });

  it('preserves service focus while the retained tier bridges a camera gap', () => {
    const expression = compileStyleExpression(serviceFocusOpacityExpr(1, true));
    const options = {
      tier: 'overview' as const,
      corridorW14: 2,
      zoom: 18,
      availability: { overview: true, district: false, street: false },
      expression,
    };
    expect(evaluateTierOpacity(options)).toBe(0.12);
    expect(evaluateTierOpacity({ ...options, featureState: { selected: true } })).toBe(1);
  });

  it('passes full MapLibre 4.7 style validation', () => {
    const layers = createLayerSpecs(MAP_THEMES.light);
    const sourceIds = new Set<string>();
    for (const specification of layers) {
      if ('source' in specification && typeof specification.source === 'string') {
        sourceIds.add(specification.source);
      }
    }
    const emptyData = { type: 'FeatureCollection' as const, features: [] };
    const sources = Object.fromEntries(
      [...sourceIds].map((sourceId) => [sourceId, { type: 'geojson' as const, data: emptyData }]),
    );
    expect(
      styleValidationMessages({
        version: 8,
        glyphs: 'https://example.com/fonts/{fontstack}/{range}.pbf',
        sources,
        layers,
      }),
    ).toEqual([]);
  });
});
