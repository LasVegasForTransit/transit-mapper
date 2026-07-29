import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { appIconPng, appIconSvg, appleTouchIconPng, appleTouchIconSvg } from './app-icon';

const LEGACY_ROUTE_PATH = 'M 20 78 C 20 55, 45 55, 50 45 C 55 35, 55 22, 80 22';

describe('TransitMapper app icon', () => {
  it('turns the toolbar Route glyph into a theme-aware rotated app mark', () => {
    const svg = appIconSvg({ kind: 'regular', theme: 'adaptive' });

    expect(svg).toContain('<circle cx="6" cy="19" r="3"');
    expect(svg).toContain('<path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"');
    expect(svg).toContain('<circle cx="18" cy="5" r="3"');
    expect(svg).toContain('rotate(45 12 12)');
    expect(svg).toContain('#E5471A');
    expect(svg).toContain('#F7F4EC');
    expect(svg).toContain('@media (prefers-color-scheme: dark)');
    expect(svg).toContain('#2D2F34');
    expect(svg).toContain('#FF8A5C');
    expect(svg).not.toContain(LEGACY_ROUTE_PATH);
  });

  it('renders opaque light raster fallbacks at the requested dimensions', async () => {
    const png = await appIconPng({ kind: 'regular', theme: 'light', size: 192 });
    const image = sharp(png);
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const corner = [...data.subarray(0, info.channels)];

    expect(metadata).toMatchObject({ format: 'png', width: 192, height: 192 });
    expect(info.channels).toBe(4);
    expect(corner).toEqual([229, 71, 26, 255]);
  });

  it('renders the Apple touch icon as a flattened glass glyph over solid Ember', async () => {
    const svg = appleTouchIconSvg();

    expect(svg).toContain('<rect width="32" height="32" fill="#E5471A"');
    expect(svg).toContain('<linearGradient id="glass-body"');
    expect(svg).toContain('<filter id="glass-elevation"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('rotate(45 12 12)');
    expect(svg).toContain('<circle cx="6" cy="19" r="3"');
    expect(svg).toContain('<path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"');
    expect(svg).toContain('<circle cx="18" cy="5" r="3"');
    expect(svg).not.toContain(LEGACY_ROUTE_PATH);

    const png = await appleTouchIconPng(180);
    const image = sharp(png);
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    expect(metadata).toMatchObject({ format: 'png', width: 180, height: 180 });
    expect(info.channels).toBe(4);
    expect([...data.subarray(0, info.channels)]).toEqual([229, 71, 26, 255]);
  });

  it('keeps every visible part of the maskable mark inside the minimum safe circle', async () => {
    const size = 512;
    const png = await appIconPng({ kind: 'maskable', theme: 'light', size });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const center = size / 2;
    const safeRadius = size * 0.4;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * info.channels;
        const [r, g, b] = data.subarray(offset, offset + 3);
        const isBackground = r === 229 && g === 71 && b === 26;
        if (isBackground) continue;
        expect(Math.hypot(x + 0.5 - center, y + 0.5 - center)).toBeLessThanOrEqual(safeRadius);
      }
    }
  });
});
