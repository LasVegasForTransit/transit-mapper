import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assertRendererCaptureHasSceneContent } from '../../scripts/renderer-capture/capture-image-validation';

async function png(width: number, height: number, scene: boolean): Promise<Buffer> {
  const background = { r: 247, g: 244, b: 236, alpha: 1 };
  const image = sharp({ create: { width, height, channels: 4, background } });
  if (!scene) return image.png().toBuffer();
  return image
    .composite([
      {
        input: {
          create: {
            width,
            height: 2,
            channels: 4,
            background: { r: 25, g: 26, b: 23, alpha: 1 },
          },
        },
        top: Math.floor(height / 2),
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

describe('renderer capture image validation', () => {
  it('rejects a screenshot with only the local canvas backdrop', async () => {
    await expect(assertRendererCaptureHasSceneContent(await png(200, 100, false))).rejects.toThrow(
      'no painted scene content',
    );
  });

  it('keeps a narrow rendered corridor as valid evidence', async () => {
    await expect(assertRendererCaptureHasSceneContent(await png(200, 100, true))).resolves.toEqual(
      expect.objectContaining({ contentPixelCount: 400 }),
    );
  });
});
