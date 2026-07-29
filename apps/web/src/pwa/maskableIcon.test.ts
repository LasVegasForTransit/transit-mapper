import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCE = new URL('../../public/icon-maskable.svg', import.meta.url);

describe('maskable install icon source', () => {
  it('uses an opaque background and keeps the mark inside the maskable safe zone', async () => {
    const svg = await readFile(SOURCE, 'utf8');

    expect(svg).toContain('<rect width="100" height="100" fill="#f4f4f1" />');
    expect(svg).toContain('transform="translate(17.5 17.5) scale(0.65)"');
  });
});
