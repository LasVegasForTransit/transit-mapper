import { describe, expect, it } from 'vitest';
import { fitBounds, metersPerPixel, projector } from '@transitmapper/core/render/project';
import { systemBounds } from '@transitmapper/core/model/geo';
import { systemSvg } from '@transitmapper/core/render/svg';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import {
  checkPreviewPng,
  MAX_PREVIEW_BYTES,
  pngDimensions,
} from '@transitmapper/core/render/pngBytes';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '@transitmapper/core/render/preview';
import { aRoad, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';

/** systemBounds returns null only for an empty system; every fixture built
 *  below has at least one way, so a null here means the fixture is wrong. */
function mustBounds(system: TransitSystem) {
  const bounds = systemBounds(system);
  if (!bounds) throw new Error('expected system to have bounds');
  return bounds;
}

describe('render/svg: station labels must not print through each other', () => {
  const view = {
    viewMode: 'network' as const,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
  };

  // Reconstruct each drawn label's box from the markup and check no two of
  // them intersect. Boxes are approximated the same way the renderer does.
  interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  const labelBoxes = (svg: string): Box[] => {
    const boxes: Box[] = [];
    for (const m of svg.matchAll(
      /<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(middle|start|end)" font-family="[^"]*" font-size="(\d+)"[^>]*>([^<]+)<\/text>/g,
    )) {
      const x = Number(m[1]),
        y = Number(m[2]),
        anchor = m[3],
        size = Number(m[4]);
      const w = m[5].length * size * 0.58;
      const left = anchor === 'middle' ? x - w / 2 : anchor === 'start' ? x : x - w;
      boxes.push({ left, right: left + w, top: y - size, bottom: y + size * 0.25 });
    }
    return boxes;
  };
  const intersects = (a: Box, b: Box) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const countCollisions = (boxes: Box[]): number => {
    let collisions = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) if (intersects(boxes[i], boxes[j])) collisions++;
    }
    return collisions;
  };
  const laneWay = (id: string, i: number) =>
    aRoad(
      id,
      [
        [-115.2 + i * 0.004, 36.1],
        [-115.2 + i * 0.004, 36.13],
      ] as LngLat[],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );

  describe('a deliberately cramped system', () => {
    // Many named stations packed close enough that naive placement overlapped
    // them (it used to print "North Las Vegas" straight through "South Strip").
    const ids = Array.from({ length: 14 }, (_, i) => `station-${i}`);
    const ways = ids.map((_, i) => laneWay(`way-${i}`, i));
    const stops = ids.map((id, i) =>
      aStop(id, [-115.2 + i * 0.004, 36.11 + (i % 3) * 0.002], undefined, {
        name: `Really Quite Long Station Name ${i}`,
      }),
    );
    const crowded = aSystem({ name: 'Crowded', ways, stops });
    const vp = fitBounds(mustBounds(crowded), { width: 1200, height: 630, padding: 56 });
    const dense = systemSvg(
      crowded,
      { ...view, presentation: renderPresentationForViewport(vp) },
      projector(vp),
      {
        title: crowded.name,
        legend: [],
        width: 1200,
        height: 630,
      },
    );
    const boxes = labelBoxes(dense);

    it('a crowded map still draws some station labels', () => {
      expect(boxes.length).toBeGreaterThan(0);
    });
    it('no two drawn labels overlap', () => {
      expect(countCollisions(boxes)).toBe(0);
    });
    // Dropping labels is the mechanism, so a crowded map is expected to show
    // fewer than it has stations — but not to give up entirely.
    it('crowding drops labels rather than all or nothing', () => {
      expect(boxes.length).toBeLessThan(ids.length);
      expect(boxes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('a system with room to breathe', () => {
    // With room to breathe, every name should still make it.
    const ids = Array.from({ length: 4 }, (_, i) => `stop-${i}`);
    const ways = ids.map((_, i) =>
      aRoad(
        `spread-way-${i}`,
        [
          [-115.4 + i * 0.3, 36.0],
          [-115.4 + i * 0.3, 36.4],
        ] as LngLat[],
        { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
      ),
    );
    const stops = ids.map((id, i) =>
      aStop(id, [-115.4 + i * 0.3, 36.2], undefined, { name: `Stop ${i}` }),
    );
    const spaced = aSystem({ ways, stops });
    const vp2 = fitBounds(mustBounds(spaced), { width: 1200, height: 630, padding: 56 });
    const roomySvg = systemSvg(
      spaced,
      { ...view, presentation: renderPresentationForViewport(vp2) },
      projector(vp2),
      {
        title: '',
        legend: [],
        width: 1200,
        height: 630,
      },
    );

    it('a sparse map keeps every station label', () => {
      expect(ids.every((_, i) => roomySvg.includes(`Stop ${i}`))).toBe(true);
    });

    // The brand font stack is interpolated into font-family="..."; if the family
    // name is double-quoted it closes the attribute early and the whole document
    // is malformed. Apostrophes are what keep it embeddable.
    it('no attribute is broken by a quoted font name', () => {
      expect(roomySvg).not.toMatch(/font-family=""/);
    });
    it('every text element is well formed', () => {
      expect((roomySvg.match(/<text /g) ?? []).length).toBe(
        (roomySvg.match(/<\/text>/g) ?? []).length,
      );
    });
  });
});

describe('render/pngBytes: what an uploaded preview card has to survive', () => {
  // Share cards are rasterized by the sharer's browser and uploaded, because
  // a free-plan Worker hasn't the CPU to draw one. These bytes are therefore
  // untrusted input, and this is the gate they pass through.
  const CARD = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };

  // A minimal but structurally complete PNG: signature, IHDR, IEND. `trailing`
  // appends bytes after IEND, which is exactly the shape of a polyglot.
  const png = (w: number, h: number, trailing = 0): Uint8Array => {
    const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const bytes = new Uint8Array(8 + 25 + 12 + trailing);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set(u32(13), 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    bytes.set(u32(w), 16);
    bytes.set(u32(h), 20);
    // 5 more IHDR bytes (bit depth, colour type, ...) + 4 CRC, left zeroed.
    bytes.set(u32(0), 33); // IEND length
    bytes.set([0x49, 0x45, 0x4e, 0x44], 37); // "IEND"
    return bytes;
  };

  it('reads dimensions out of a PNG header', () => {
    expect(pngDimensions(png(1200, 630))).toEqual(CARD);
  });
  it('a correctly sized card is accepted', () => {
    expect(checkPreviewPng(png(1200, 630), CARD).ok).toBe(true);
  });

  // Each of these is a way the endpoint could otherwise become general-purpose
  // file storage on our own domain.
  it('empty bytes are rejected', () => {
    expect(checkPreviewPng(new Uint8Array(0), CARD).ok).toBe(false);
  });
  it('a non-PNG is rejected', () => {
    expect(
      checkPreviewPng(
        new Uint8Array([
          0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0,
        ]),
        CARD,
      ).ok,
    ).toBe(false);
  });
  it('a truncated file is rejected', () => {
    expect(checkPreviewPng(png(1200, 630).subarray(0, 20), CARD).ok).toBe(false);
  });
  it('a wrongly sized image is rejected', () => {
    expect(checkPreviewPng(png(64, 64, 0), CARD).ok).toBe(false);
  });
  it('an oversized file is rejected', () => {
    expect(checkPreviewPng(png(1200, 630, MAX_PREVIEW_BYTES), CARD).ok).toBe(false);
  });

  it('a PNG with data appended after IEND is rejected', () => {
    // A polyglot: a structurally valid PNG with a payload appended after IEND.
    // Response headers already make it inert, but it shouldn't be stored at all.
    const polyglot = png(1200, 630, 32);
    polyglot.set([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e], 8 + 25 + 12); // "<script>"
    expect(checkPreviewPng(polyglot, CARD).ok).toBe(false);
  });
  it('a PNG with no IEND is rejected', () => {
    expect(checkPreviewPng(png(1200, 630).subarray(0, 33), CARD).ok).toBe(false);
  });

  it('a PNG signature with no IHDR is rejected', () => {
    // A PNG signature with a different chunk where IHDR belongs is malformed,
    // and is the shape a polyglot file would take.
    const notIhdr = png(1200, 630);
    notIhdr.set([0x74, 0x45, 0x58, 0x74], 12); // "tEXt"
    expect(checkPreviewPng(notIhdr, CARD).ok).toBe(false);
  });

  it('a rejection explains itself without leaking internals', () => {
    // Rejection reasons are returned to the uploader, so they must describe the
    // upload rather than anything about the server.
    const reason = checkPreviewPng(new Uint8Array(1), CARD).reason ?? '';
    expect(reason.length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/\/|internal|stack/i);
  });
});

describe('render/project: the map-free projection the Worker draws through', () => {
  const diff = (a: number, b: number) => Math.abs(a - b);

  const vp = { center: [-115.14, 36.17] as LngLat, zoom: 12, width: 1200, height: 630 };
  const project = projector(vp);

  it('the viewport center projects to the center pixel', () => {
    const middle = project(vp.center);
    expect(diff(middle.x, 600)).toBeLessThan(1e-9);
    expect(diff(middle.y, 315)).toBeLessThan(1e-9);
  });

  it('longitude east of center moves right', () => {
    const middle = project(vp.center);
    const east = project([-115.0, 36.17]);
    expect(east.x).toBeGreaterThan(middle.x);
  });
  it("a pure longitude change doesn't move vertically", () => {
    const middle = project(vp.center);
    const east = project([-115.0, 36.17]);
    expect(diff(east.y, middle.y)).toBeLessThan(1e-9);
  });

  it('latitude north of center moves UP the screen', () => {
    const middle = project(vp.center);
    const north = project([-115.14, 36.3]);
    expect(north.y).toBeLessThan(middle.y);
  });

  it('one zoom level doubles projected distance', () => {
    // Zooming in one level doubles the pixel distance between two fixed points —
    // this is what "zoom is a log2 scale factor" has to mean for the Worker's
    // framing to match MapLibre's.
    const middle = project(vp.center);
    const dxAt12 = project([-115.0, 36.17]).x - middle.x;
    const dxAt13 =
      projector({ ...vp, zoom: 13 })([-115.0, 36.17]).x -
      projector({ ...vp, zoom: 13 })(vp.center).x;
    expect(diff(dxAt13 / dxAt12, 2)).toBeLessThan(1e-9);
  });

  describe('fitBounds', () => {
    // fitBounds is what frames a stored system with no map to ask.
    const bounds: [LngLat, LngLat] = [
      [-115.3, 36.0],
      [-115.0, 36.3],
    ];
    const fitted = fitBounds(bounds, { width: 1200, height: 630, padding: 40 });
    const fit = projector(fitted);
    const sw = fit(bounds[0]);
    const ne = fit(bounds[1]);

    it('fitBounds keeps the whole extent inside the viewport', () => {
      expect(sw.x).toBeGreaterThanOrEqual(0);
      expect(ne.x).toBeLessThanOrEqual(1200);
      expect(ne.y).toBeGreaterThanOrEqual(0);
      expect(sw.y).toBeLessThanOrEqual(630);
    });
    it('fitBounds respects the padding on the tight axis', () => {
      expect(ne.y).toBeGreaterThanOrEqual(39.9);
      expect(sw.y).toBeLessThanOrEqual(590.1);
    });
    it('fitBounds centers the extent horizontally', () => {
      expect(diff((sw.x + ne.x) / 2, 600)).toBeLessThan(0.5);
    });
    it('fitBounds centers the extent vertically', () => {
      expect(diff((sw.y + ne.y) / 2, 315)).toBeLessThan(0.5);
    });
  });

  describe('degenerate and lopsided extents', () => {
    it('a zero-extent system falls back to maxZoom', () => {
      // A one-station system has zero extent, which would otherwise fit at
      // infinite zoom — maxZoom is the only thing standing between that and a
      // divide-by-zero framing bug.
      const degenerate = fitBounds(
        [
          [-115.14, 36.17],
          [-115.14, 36.17],
        ],
        { width: 1200, height: 630, padding: 40, maxZoom: 14 },
      );
      expect(degenerate.zoom).toBe(14);
    });
    it('a zero-extent system centers on its single point', () => {
      const degenerate = fitBounds(
        [
          [-115.14, 36.17],
          [-115.14, 36.17],
        ],
        { width: 1200, height: 630, padding: 40, maxZoom: 14 },
      );
      expect(diff(degenerate.center[0], -115.14)).toBeLessThan(1e-9);
    });

    it('a wide flat system is framed by its width', () => {
      // A system that's wide but flat must be constrained by width, not height.
      const wide = fitBounds(
        [
          [-116.0, 36.16],
          [-114.0, 36.18],
        ],
        { width: 1200, height: 630, padding: 40 },
      );
      const wideProject = projector(wide);
      const left = wideProject([-116.0, 36.16]);
      expect(left.x).toBeGreaterThanOrEqual(39.9);
      expect(left.x).toBeLessThanOrEqual(40.1);
    });
  });

  describe('metersPerPixel', () => {
    it('metersPerPixel shrinks as zoom grows', () => {
      expect(metersPerPixel({ ...vp, zoom: 13 })).toBeLessThan(metersPerPixel(vp));
    });
    it('metersPerPixel matches the known zoom-0 equator value', () => {
      // Zoom 0 at the equator is the textbook ~156.5 km per pixel on 256px tiles,
      // or ~78.3 km on the 512px tiles MapLibre uses.
      expect(
        diff(metersPerPixel({ center: [0, 0], zoom: 0, width: 1, height: 1 }), 40075016.686 / 512),
      ).toBeLessThan(1e-6);
    });
  });
});
