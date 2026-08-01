import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), 'utf8');
}

describe('public product metadata', () => {
  it('describes an open beta without renaming TransitMapper', () => {
    const editor = source('index.html');
    const embed = source('embed.html');
    const manifest = JSON.parse(source('public/manifest.json')) as {
      name: string;
      short_name: string;
      description: string;
    };

    expect(editor).toContain('<title>TransitMapper</title>');
    expect(editor.match(/open beta/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(embed).toContain('<title>TransitMapper</title>');
    expect(embed).toMatch(/name="description"[^>]+open beta/i);
    expect(manifest).toMatchObject({
      name: 'TransitMapper',
      short_name: 'TransitMapper',
    });
    expect(manifest.description).toMatch(/open beta/i);
  });
});
