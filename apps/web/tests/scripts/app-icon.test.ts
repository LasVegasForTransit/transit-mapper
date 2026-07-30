import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { appleTouchIconLayerPng } from '../../scripts/app-icon';

interface HorizontalInsets {
  left: number;
  right: number;
}

async function horizontalAlphaInsets(image: Buffer): Promise<HorizontalInsets> {
  const { data, info } = await sharp(image)
    .resize(180, 180)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minimumX = info.width;
  let maximumX = -1;

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * 4 + 3] <= 8) continue;
    const x = pixel % info.width;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
  }

  if (maximumX < 0) throw new Error('Apple icon layer has no visible pixels.');
  return {
    left: minimumX,
    right: info.width - 1 - maximumX,
  };
}

describe('Apple icon layer', () => {
  it('keeps the Route silhouette within its 16dp horizontal inset', async () => {
    const insets = await horizontalAlphaInsets(await appleTouchIconLayerPng());

    expect(insets.left).toBeGreaterThanOrEqual(15);
    expect(insets.left).toBeLessThanOrEqual(17);
    expect(insets.right).toBeGreaterThanOrEqual(15);
    expect(insets.right).toBeLessThanOrEqual(17);
  });
});
