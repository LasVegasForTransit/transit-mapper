import { describe, expect, it } from 'vitest';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import { wholeLeg } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import * as projection from '../src/projection';

const view: RenderViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation: renderPresentationForViewport({
    center: [-115.16, 36.14],
    zoom: 14,
    width: 1_440,
    height: 900,
  }),
};

interface PatternOverlayProperties {
  readonly serviceId?: string;
  readonly patternId?: string;
  readonly hitTarget?: boolean;
}

interface PatternOverlayResult {
  path: FeatureCollection<LineString, PatternOverlayProperties>;
  arrows: FeatureCollection<LineString, PatternOverlayProperties>;
  termini: FeatureCollection<Point, PatternOverlayProperties>;
}

type ProjectPatternOverlay = (input: {
  system: TransitSystem;
  serviceId: string;
  patternId: string;
  view: RenderViewOptions;
}) => PatternOverlayResult;

function overlayProjector(): ProjectPatternOverlay {
  const candidate = (projection as Record<string, unknown>).projectPatternOverlay;
  expect(candidate).toBeTypeOf('function');
  return candidate as ProjectPatternOverlay;
}

describe('Pattern overlay projection', () => {
  it('projects only the active pattern with its editing targets', () => {
    const west = aRoad('west', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const north = aRoad('north', [
      [-115.16, 36.14],
      [-115.16, 36.16],
    ]);
    const east = aRoad('east', [
      [-115.16, 36.14],
      [-115.14, 36.14],
    ]);
    const active = aService('active', [
      {
        id: 'active',
        sections: [
          {
            kind: 'split',
            outbound: [wholeLeg(west.id), wholeLeg(north.id)],
            inbound: [wholeLeg(east.id), wholeLeg(west.id)],
          },
        ],
      },
    ]);
    const sibling = aService('sibling', [
      { id: 'sibling', sections: [{ kind: 'shared', legs: [wholeLeg(west.id)] }] },
    ]);
    const system = aSystem({ ways: [west, north, east], services: [active, sibling] });

    const overlay = overlayProjector()({
      system,
      serviceId: active.id,
      patternId: active.path.id,
      view,
    });

    expect(overlay.path.features).not.toHaveLength(0);
    expect(new Set(overlay.path.features.map((feature) => feature.properties.serviceId))).toEqual(
      new Set([active.id]),
    );
    expect(overlay.path.features.some((feature) => feature.properties.hitTarget === true)).toBe(
      true,
    );
    expect(overlay.arrows.features).not.toHaveLength(0);
    expect(new Set(overlay.arrows.features.map((feature) => feature.properties.serviceId))).toEqual(
      new Set([active.id]),
    );
    expect(overlay.termini.features).toHaveLength(2);
    expect(
      new Set(overlay.termini.features.map((feature) => feature.properties.patternId)),
    ).toEqual(new Set([active.path.id]));
  });
});
