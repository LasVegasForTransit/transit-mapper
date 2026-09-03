import { describe, expect, it } from 'vitest';
import {
  PREVIEW_FONT_FAMILY,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  previewRenderView,
  previewSvg,
} from '@transitmapper/core/render/preview';
import { lineSceneFeatures, projectSchemaV16LineScene } from '@transitmapper/renderer/line';
import { systemSvg } from '@transitmapper/core/render/svg';
import { fitBounds, projector } from '@transitmapper/core/render/project';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { systemBounds } from '@transitmapper/core/model/geo';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { LVBT } from '@transitmapper/core/style/lvbtBrand';
import { aPattern, aRoad, aService, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';

/** systemBounds returns null only for an empty system; every fixture built
 *  below has at least one way, so a null here means the fixture is wrong. */
function mustBounds(system: TransitSystem) {
  const bounds = systemBounds(system);
  if (!bounds) throw new Error('expected system to have bounds');
  return bounds;
}

describe('render/preview: the card the Worker rasterizes for link unfurls', () => {
  const line = aRoad(
    'line',
    [
      [-115.22, 36.06],
      [-115.14, 36.16],
      [-115.12, 36.24],
    ] as LngLat[],
    { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
  );
  const pattern = aPattern('pattern', [line], ['line']);
  const service = aService('svc', [pattern], { name: 'Resort Corridor', modeId: 'lightRail' });
  const stop = aStop('station', [-115.14, 36.16], undefined, { name: 'Downtown' });
  const system = aSystem({
    name: 'Valley Rapid Transit',
    ways: [line],
    services: [service],
    stops: [stop],
  });

  const svg = previewSvg(system);

  // Composed at half the raster size so the 2x scale-up doubles every font
  // size and line weight relative to the finished card.
  it('preview is composed at half Open Graph card size', () => {
    expect(
      svg.startsWith(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH / 2}" height="${PREVIEW_HEIGHT / 2}"`,
      ),
    ).toBe(true);
  });
  it("preview draws the system's lines", () => {
    expect(svg).toContain('<path');
  });
  it('preview draws stops', () => {
    expect(svg).toContain('<circle');
  });

  // A social card is the network and nothing else. Two presentation facts
  // produce that, and neither one names an element to remove: the surface
  // captions itself (so the title and legend would just repeat the text Slack
  // already shows), and at ~460px the smaller type falls under the legibility
  // floor. There is no "card mode" anywhere in the renderer.
  it('a social card carries no text at all', () => {
    expect(svg).not.toMatch(/<text/);
  });
  it("a social card doesn't repeat the system name", () => {
    expect(svg).not.toContain('Valley Rapid Transit');
  });
  it("a social card doesn't repeat the line names", () => {
    expect(svg).not.toContain('Resort Corridor');
  });
  it('a social card drops illegible stop labels', () => {
    expect(svg).not.toContain('Downtown');
  });
  it('a social card drops the scale bar and north arrow', () => {
    expect(svg).not.toMatch(/\d+ (km|m)<\/text>/);
    expect(svg).not.toContain('>N</text>');
  });

  // Same composition, same code path, told it will be seen large and that
  // nothing else is captioning it: the detail comes back. This is what makes
  // it one renderer rather than two.
  const bigSvg = previewSvg(system, { displayWidth: 1200, captionedExternally: false });
  it('a large uncaptioned preview keeps stop labels', () => {
    expect(bigSvg).toContain('Downtown');
  });
  it('a large uncaptioned preview keeps its title', () => {
    expect(bigSvg).toContain('Valley Rapid Transit');
  });
  it('a large uncaptioned preview keeps its legend', () => {
    expect(bigSvg).toContain('Resort Corridor');
  });
  it('a large uncaptioned preview keeps the scale bar', () => {
    expect(bigSvg).toMatch(/\d+ (km|m)<\/text>/);
  });
  it('a large uncaptioned preview keeps the north arrow', () => {
    expect(bigSvg).toContain('>N</text>');
  });

  // Size and captioning are independent: a big drawing that something else is
  // captioning still skips the caption, but keeps the detail it can show.
  it('captioning is independent of size', () => {
    const bigCaptioned = previewSvg(system, { displayWidth: 1200 });
    expect(bigCaptioned).not.toContain('Valley Rapid Transit');
    expect(bigCaptioned).toContain('Downtown');
  });

  // Geometry paths are the ones with fill="none"; the north arrow is a filled
  // path, so counting every <path> would compare furniture too.
  it('both sizes draw exactly the same geometry', () => {
    const geometryPaths = (s: string) => (s.match(/<path [^>]*fill="none"/g) ?? []).length;
    expect(geometryPaths(bigSvg)).toBe(geometryPaths(svg));
    expect(geometryPaths(svg)).toBeGreaterThan(0);
  });

  describe('a long legend', () => {
    // A legend must never outgrow the drawing it captions. Twenty lines used to
    // produce a panel taller than the card, running off the top edge.
    const manyLines = Array.from({ length: 20 }, (_, i) => ({
      color: '#e8562a',
      label: `Line ${i + 1}`,
    }));
    const cardHeight = PREVIEW_HEIGHT / 2;
    const crowdedViewport = fitBounds(mustBounds(system), {
      width: PREVIEW_WIDTH / 2,
      height: cardHeight,
      padding: 28,
    });
    const crowded = systemSvg(
      system,
      {
        viewMode: 'network',
        visibleModes: new Set(MODE_ORDER),
        visibleWayTypes: new Set(WAY_TYPE_ORDER),
        presentation: renderPresentationForViewport(crowdedViewport),
      },
      projector(crowdedViewport),
      {
        title: system.name,
        legend: manyLines,
        width: PREVIEW_WIDTH / 2,
        height: cardHeight,
      },
    );

    it('a long legend stays inside the drawing', () => {
      // Both the title and the legend draw a translucent backing panel; the
      // legend's is the lower one, so take the largest y.
      const panelTops = [
        ...crowded.matchAll(/<rect x="0" y="([\d.]+)" width="\d+" height="[\d.]+" fill="rgba/g),
      ].map((m) => Number(m[1]));
      const panelTop = Math.max(...panelTops);
      expect(panelTop).toBeGreaterThan(0);
      expect(panelTop).toBeGreaterThanOrEqual(cardHeight * (1 - 0.56));
    });
    it('a long legend says how many it left out', () => {
      expect(crowded).toMatch(/\+\d+ more/);
    });
    it('a short legend is never truncated', () => {
      expect(svg).not.toMatch(/\+\d+ more/);
    });
  });

  describe('the export path', () => {
    // The export path (share/svgExport.ts) calls systemSvg with no displayWidth
    // at all, which must keep meaning "assume it's viewed at the size it was
    // drawn" — full detail, exactly as before any of this existed.
    const exportBounds = mustBounds(system);
    const exportViewport = fitBounds(exportBounds, { width: 1200, height: 630, padding: 56 });
    const exportSvg = systemSvg(
      system,
      {
        viewMode: 'network',
        visibleModes: new Set(MODE_ORDER),
        visibleWayTypes: new Set(WAY_TYPE_ORDER),
        presentation: renderPresentationForViewport(exportViewport),
      },
      projector(exportViewport),
      {
        title: system.name,
        legend: [{ color: '#e8562a', label: 'Resort Corridor' }],
        width: 1200,
        height: 630,
        scaleBar: { widthPx: 100, label: '5 km' },
      },
    );

    it('an export keeps stop labels when no display size is given', () => {
      expect(exportSvg).toContain('Downtown');
    });
    it('an export keeps its scale bar and north arrow', () => {
      expect(exportSvg).toContain('5 km');
      expect(exportSvg).toContain('>N</text>');
    });
  });

  // resvg inside a Worker has no system fonts, so wherever a server-rendered
  // drawing does have text, the markup must name the one font that actually
  // gets bundled — "system-ui" would silently render every label as nothing.
  // Checked against the variant that has text, since a card has none.
  it('a server-rendered drawing names the bundled font', () => {
    expect(bigSvg).toContain(`font-family="${PREVIEW_FONT_FAMILY}"`);
  });
  it('a server-rendered drawing never asks for a system font', () => {
    expect(bigSvg).not.toContain('system-ui');
  });
  // Literals on purpose: these pin the brand decision, so drifting back to a
  // hand-picked near-white or the editor's own typeface fails loudly.
  // Source of truth is lasvegasfortransit.org/brand.
  it('the bundled font is the brand face', () => {
    expect(PREVIEW_FONT_FAMILY).toBe('Public Sans');
  });
  it('the card ground is the brand surface', () => {
    expect(svg).toContain(`fill="${LVBT.light.surface}"`);
    expect(LVBT.light.surface).toBe('#F7F4EC');
  });
  it('the card rule is the brand outline', () => {
    expect(svg).toContain(`stroke="${LVBT.light.outline}"`);
    expect(LVBT.light.outline).toBe('#0F1115');
  });
  // The framed area is a raised surface on the base one — two brand tokens,
  // not one. Flattening them back together is a regression, not a tidy-up.
  it('the framed panel uses the raised-surface token', () => {
    expect(svg).toContain(`fill="${LVBT.light.surfaceContainer}"`);
    expect(LVBT.light.surfaceContainer).toBe('#EFE9DB');
  });
  // Compared as plain strings on purpose. The tokens are `const`-typed, so
  // tsc can see the two literals differ and flags the comparison as pointless
  // — but the point is to fail if someone later edits one token to equal the
  // other, which is a runtime question about the brand, not a type question.
  it('the panel and the ground are different tokens', () => {
    expect(LVBT.light.surfaceContainer as string).not.toBe(LVBT.light.surface);
  });

  // Pure white and the editor's cool ink have no business in anything that
  // leaves the app carrying the org's name.
  it('no pure white leaks into a share card', () => {
    expect(svg).not.toMatch(/#ffffff|#FFFFFF/);
  });
  it('no non-brand ink leaks into a share card', () => {
    expect(svg).not.toMatch(/#191a17|#111827/i);
  });

  describe('a hostile system name', () => {
    // A share's name is unauthenticated user text and this markup is assembled
    // by hand, so escaping is the only thing standing between a system name and
    // broken (or injected) SVG.
    // Checked where the name is actually drawn — a social card never draws it,
    // so testing escaping there would pass for the wrong reason.
    const hostile = aSystem({ name: '</text><script>alert(1)</script>' });
    const hostileSvg = previewSvg(hostile, { captionedExternally: false, displayWidth: 1200 });

    it('the drawn title carries the hostile name at all', () => {
      expect(hostileSvg).toContain('alert(1)');
    });
    it("a system name can't inject markup into a drawing", () => {
      expect(hostileSvg).not.toContain('<script>');
    });
    it('a hostile system name is escaped, not dropped', () => {
      expect(hostileSvg).toContain('&lt;script&gt;');
    });
  });

  describe('an empty system', () => {
    // An empty system has no extent to frame; it must still produce a card
    // rather than dividing by zero on its own bounds.
    const empty = aSystem({ name: 'Nothing yet' });

    it('an empty system still renders a card', () => {
      expect(previewSvg(empty).startsWith('<svg')).toBe(true);
    });
    it("an empty system's name survives where one is drawn", () => {
      expect(previewSvg(empty, { captionedExternally: false })).toContain('Nothing yet');
    });
  });
});

describe('render/preview: the passenger Lines a share card draws', () => {
  const carrier = aRoad('carrier', [
    [-115.22, 36.14],
    [-115.16, 36.14],
  ] as LngLat[]);

  async function cardFor(system: TransitSystem): Promise<string> {
    const scene = await projectSchemaV16LineScene({
      system,
      view: previewRenderView(system),
      sceneRevision: `preview:${system.id}`,
    });
    return previewSvg(system, { passengerLines: lineSceneFeatures(scene) });
  }

  /** Distinct route identities, counted by the role each Line feature was
   *  named with. Every identity paints once per pass, so the raw attribute
   *  occurrences say nothing about how many stripes the card carries. */
  function routeRoleCounts(card: string): { casings: number; stripes: number } {
    const ids = new Set(
      [...card.matchAll(/data-render-source="services" data-feature-id="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    );
    return {
      casings: [...ids].filter((id) => id.includes('line-casing')).length,
      stripes: [...ids].filter((id) => id.includes('line-stripe')).length,
    };
  }

  it('draws one stripe for a Line two ServicePlans serve', async () => {
    const local = aService('local', [aPattern('local-pattern', [carrier], [carrier.id])]);
    const express = aService('express', [aPattern('express-pattern', [carrier], [carrier.id])]);
    const system = aSystem({
      name: 'Shared carrier',
      ways: [carrier],
      services: [local, express],
      lines: [
        {
          id: 'shared-line',
          name: 'Shared',
          color: '#123456',
          serviceIds: [local.id, express.id],
        },
      ],
    });

    const card = await cardFor(system);

    expect(routeRoleCounts(card)).toEqual({ casings: 1, stripes: 1 });
    expect(card).toContain('stroke="#123456"');
  });

  it('draws one stripe per Line when two Lines share a carrier', async () => {
    const first = aService('first', [aPattern('first-pattern', [carrier], [carrier.id])]);
    const second = aService('second', [aPattern('second-pattern', [carrier], [carrier.id])]);
    const system = aSystem({
      name: 'Two lines',
      ways: [carrier],
      services: [first, second],
      lines: [
        { id: 'first-line', name: 'First', color: '#123456', serviceIds: [first.id] },
        { id: 'second-line', name: 'Second', color: '#abcdef', serviceIds: [second.id] },
      ],
    });

    const card = await cardFor(system);

    expect(routeRoleCounts(card)).toEqual({ casings: 1, stripes: 2 });
    expect(card).toContain('stroke="#123456"');
    expect(card).toContain('stroke="#abcdef"');
  });

  it('drops the per-ServicePlan stripes the document would otherwise draw', async () => {
    const local = aService('local', [aPattern('local-pattern', [carrier], [carrier.id])]);
    const express = aService('express', [aPattern('express-pattern', [carrier], [carrier.id])]);
    const system = aSystem({
      name: 'Shared carrier',
      ways: [carrier],
      services: [local, express],
      lines: [
        {
          id: 'shared-line',
          name: 'Shared',
          color: '#123456',
          serviceIds: [local.id, express.id],
        },
      ],
    });

    const withoutLines = previewSvg(system);
    const withLines = await cardFor(system);

    expect(routeRoleCounts(withoutLines)).toEqual({ casings: 0, stripes: 0 });
    expect(withoutLines).toContain('data-feature-id="render:services:paint-fragment');
    expect(withLines).not.toContain('data-feature-id="render:services:paint-fragment');
  });
});
