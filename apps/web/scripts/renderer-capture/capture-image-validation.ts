import sharp from 'sharp';

export interface RendererCaptureImageCoverage {
  readonly contentPixelCount: number;
  readonly minimumContentPixelCount: number;
  readonly width: number;
  readonly height: number;
}

const COLOR_QUANTUM = 8;
const CONTENT_COLOR_DELTA = 24;

function colorBucket(red: number, green: number, blue: number): number {
  return (
    (Math.floor(red / COLOR_QUANTUM) << 10) |
    (Math.floor(green / COLOR_QUANTUM) << 5) |
    Math.floor(blue / COLOR_QUANTUM)
  );
}

function bucketColor(bucket: number): readonly [number, number, number] {
  const red = ((bucket >> 10) & 31) * COLOR_QUANTUM + COLOR_QUANTUM / 2;
  const green = ((bucket >> 5) & 31) * COLOR_QUANTUM + COLOR_QUANTUM / 2;
  const blue = (bucket & 31) * COLOR_QUANTUM + COLOR_QUANTUM / 2;
  return [red, green, blue];
}

function dominantBackdrop(data: Buffer): readonly [number, number, number] {
  const buckets = new Map<number, number>();
  for (let offset = 0; offset < data.length; offset += 4) {
    const bucket = colorBucket(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let dominantBucket = 0;
  let largestCount = -1;
  for (const [bucket, count] of buckets) {
    if (count > largestCount) {
      dominantBucket = bucket;
      largestCount = count;
    }
  }
  return bucketColor(dominantBucket);
}

/**
 * A renderer capture is useful only when it contains rendered system pixels.
 * `subject` names the frame under test, because a blank capture is otherwise
 * indistinguishable between fixtures.
 * The capture path removes application chrome and its drafting grid first, so
 * the dominant image colour is the deterministic local backdrop. A narrow
 * corridor still occupies far more than the small anti-aliasing allowance.
 */
export async function assertRendererCaptureHasSceneContent(
  image: Buffer,
  subject = 'the current capture',
): Promise<RendererCaptureImageCoverage> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const backdrop = dominantBackdrop(data);
  let contentPixelCount = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const delta = Math.max(
      Math.abs((data[offset] ?? 0) - backdrop[0]),
      Math.abs((data[offset + 1] ?? 0) - backdrop[1]),
      Math.abs((data[offset + 2] ?? 0) - backdrop[2]),
    );
    if (delta >= CONTENT_COLOR_DELTA) contentPixelCount += 1;
  }
  const minimumContentPixelCount = Math.max(20, Math.ceil((info.width * info.height) / 2_000));
  if (contentPixelCount < minimumContentPixelCount) {
    throw new Error(
      `Renderer capture of ${subject} has no painted scene content: ` +
        `${contentPixelCount} pixels, expected at least ${minimumContentPixelCount}.`,
    );
  }
  return { contentPixelCount, minimumContentPixelCount, width: info.width, height: info.height };
}
