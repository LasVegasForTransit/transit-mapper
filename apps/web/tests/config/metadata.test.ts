import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const REPOSITORY_ROOT = resolve(WEB_ROOT, '../..');

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

  it('resolves manifest navigation and icons within either public mount', () => {
    const manifest = JSON.parse(source('public/manifest.json')) as {
      id?: string;
      start_url: string;
      scope: string;
      icons: { src: string }[];
    };

    expect(manifest.id).toBeUndefined();
    for (const mount of [
      'https://map.lasvegasfortransit.org/',
      'https://labs.lasvegasfortransit.org/transit-mapper/',
    ]) {
      const manifestUrl = new URL('manifest.json', mount);
      expect(new URL(manifest.start_url, manifestUrl).href).toBe(mount);
      expect(new URL(manifest.scope, manifestUrl).href).toBe(mount);
      for (const icon of manifest.icons) {
        expect(new URL(icon.src, manifestUrl).href.startsWith(`${mount}icons/`)).toBe(true);
      }
    }
  });

  it('attributes the transferred copyright only to LVBT', () => {
    const license = readFileSync(resolve(REPOSITORY_ROOT, 'LICENSE'), 'utf8');

    expect(license.match(/^Copyright \(c\) .+$/gm)).toEqual([
      'Copyright (c) 2026 Las Vegans for Better Transit',
    ]);
  });

  it('dispatches release pull request validation without a checkout', () => {
    const workflow = readFileSync(
      resolve(REPOSITORY_ROOT, '.github/workflows/deploy-production.yml'),
      'utf8',
    );

    expect(workflow).toContain(
      'gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$release_branch"',
    );
  });

  it("does not reformat Release Please's canonical changelog", () => {
    const prettierIgnore = readFileSync(resolve(REPOSITORY_ROOT, '.prettierignore'), 'utf8');

    expect(prettierIgnore.split('\n')).toContain('CHANGELOG.md');
  });
});
