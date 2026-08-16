import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GLYPH_ROOT = resolve(import.meta.dirname, '../../public/glyphs/noto-sans-v1');
const UPSTREAM_REVISION = '025ff2b2f84cc0fdf11f7b1d74b3a784595fe7a4';

function fontDigest(fontName: string): { count: number; digest: string } {
  const directory = resolve(GLYPH_ROOT, fontName);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.pbf'))
    .sort((left, right) => Number.parseInt(left) - Number.parseInt(right));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(resolve(directory, file)));
  }
  return { count: files.length, digest: hash.digest('hex') };
}

describe('local MapLibre glyph assets', () => {
  it('records the exact upstream revision, font aliases, and license', () => {
    const sourcePath = resolve(GLYPH_ROOT, 'SOURCE.md');
    expect(existsSync(sourcePath)).toBe(true);
    if (!existsSync(sourcePath)) return;

    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain('https://github.com/openmaptiles/fonts');
    expect(source).toContain(UPSTREAM_REVISION);
    expect(source).toContain('Klokantech Noto Sans Regular');
    expect(source).toContain('Noto Sans Regular');
    expect(source).toContain('Klokantech Noto Sans Bold');
    expect(source).toContain('Noto Sans Bold');
    expect(existsSync(resolve(GLYPH_ROOT, 'LICENSE.txt'))).toBe(true);
  });

  it('retains every BMP range with deterministic regular and bold hashes', () => {
    expect(fontDigest('Noto Sans Regular')).toEqual({
      count: 256,
      digest: 'cff884a0c6a1b088b8791666842b7b2d2f94282417b03b41ec5d30e26b05fe0f',
    });
    expect(fontDigest('Noto Sans Bold')).toEqual({
      count: 256,
      digest: '8a1a3afdd47b9cd05c6d58e5bc64defe8a9237c3111b00fe0e6418804f18fcf4',
    });
  });
});
