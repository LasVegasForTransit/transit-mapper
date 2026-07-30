import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import { metersFromOrigin } from '@transitmapper/core/model/geo';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewHarness = vi.hoisted(() => ({
  diagramProjection: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
  effectDependencies: [] as unknown[][],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
      previewHarness.effects.push(effect);
      previewHarness.effectDependencies.push(dependencies);
    },
    useRef: () => ({ current: {} }),
  };
});

vi.mock('maplibre-gl', () => {
  class FakeMap {
    on(): this {
      return this;
    }

    remove(): void {}
  }

  return { default: { Map: FakeMap } };
});

vi.mock('@transitmapper/core/model/diagramLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@transitmapper/core/model/diagramLayout')>();
  return {
    ...actual,
    computeDiagramSystem: (system: Parameters<typeof actual.computeDiagramSystem>[0]) => {
      previewHarness.diagramProjection(system);
      return actual.computeDiagramSystem(system);
    },
  };
});

vi.mock('../../src/theme/systemColorScheme', () => ({
  useSystemColorScheme: () => 'light',
}));

import { OnboardingPreviewMap } from '../../src/ui/onboarding/OnboardingPreviewMap';
import { ONBOARDING_FIXTURE_SYSTEM } from '../../src/ui/onboarding/fixtureSystem';

beforeEach(() => {
  previewHarness.diagramProjection.mockClear();
  previewHarness.effects.length = 0;
  previewHarness.effectDependencies.length = 0;
});

describe('OnboardingPreviewMap', () => {
  it('rebuilds when the slide changes its view or animation', () => {
    const system = createEmptySystem();
    const view: ViewOptions = {
      viewMode: 'network',
      visibleModes: new Set(),
      visibleWayTypes: new Set(),
    };

    OnboardingPreviewMap({ system, view, animateVehicle: true });

    expect(previewHarness.effectDependencies[0]).toContain(system);
    expect(previewHarness.effectDependencies[0]).toContain(view);
    expect(previewHarness.effectDependencies[0]).toContain(true);
  });

  it('gives Diagram visibly different geometry from the geographic views', () => {
    const diagram = computeDiagramSystem(ONBOARDING_FIXTURE_SYSTEM);
    const directionIsOffGrid = (from: [number, number], to: [number, number]) => {
      const [dx, dy] = metersFromOrigin(from, to);
      const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      const nearestDiagramDirection = Math.round(degrees / 45) * 45;
      return Math.abs(degrees - nearestDiagramDirection) > 5;
    };
    const hasOffGridSegment = (ways: typeof ONBOARDING_FIXTURE_SYSTEM.ways) =>
      ways.some((way) =>
        way.points.slice(1).some((point, index) => directionIsOffGrid(way.points[index], point)),
      );

    expect(hasOffGridSegment(ONBOARDING_FIXTURE_SYSTEM.ways)).toBe(true);
    expect(hasOffGridSegment(diagram.ways)).toBe(false);
  });

  it('renders Diagram from the schematic projection', () => {
    const view: ViewOptions = {
      viewMode: 'diagram',
      visibleModes: new Set(['bus', 'lightRail']),
      visibleWayTypes: new Set(['road', 'lightRail']),
    };

    OnboardingPreviewMap({ system: ONBOARDING_FIXTURE_SYSTEM, view });
    const cleanup = previewHarness.effects[0]?.();

    expect(previewHarness.diagramProjection).toHaveBeenCalledWith(ONBOARDING_FIXTURE_SYSTEM);
    cleanup?.();
  });

  it('keeps every fixture stop attached to its corridor in Diagram', () => {
    expect(ONBOARDING_FIXTURE_SYSTEM.stations.every((station) => station.anchors.length > 0)).toBe(
      true,
    );
  });
});
