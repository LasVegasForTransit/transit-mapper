import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(new URL('../../src/theme/tokens.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../src/ui/app.css', import.meta.url), 'utf8');
const sourceRoot = new URL('../../src/', import.meta.url);

interface ThemeConsumer {
  path: string;
  source: string;
}

function readThemeConsumers(directory: URL, relativePath = ''): ThemeConsumer[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name, directory.href.endsWith('/') ? directory : `${directory}/`);
    const path = `${relativePath}${entry.name}`;
    if (entry.isDirectory()) return readThemeConsumers(new URL(`${child.href}/`), `${path}/`);
    return /\.(?:css|ts|tsx)$/.test(entry.name)
      ? [{ path, source: readFileSync(child, 'utf8') }]
      : [];
  });
}

const themeConsumers = readThemeConsumers(sourceRoot);
const themeConsumerText = themeConsumers.map(({ source }) => source).join('\n');

const COLOR_ROLES = [
  'surface',
  'background',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'on-surface',
  'on-surface-variant',
  'outline',
  'outline-variant',
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'error',
  'on-error',
  'error-container',
  'on-error-container',
  'inverse-surface',
  'inverse-on-surface',
  'scrim',
  'shadow',
] as const;

const LEGACY_TOKEN =
  /--(?:bg|surface-2|surface|border-strong|border|text-faint|text-muted|text|ink|accent-soft|accent|danger-soft|danger|shadow|fs-[a-z-]+)\b/;
const COLOR_LITERAL = /#[\da-f]{3,8}\b|rgba?\([^)]*\)|rgb\([^)]*\)/gi;
const AUDITED_COLOR_SOURCES = new Set([
  'map/mapThemePalette.ts',
  'perf/fixtures.ts',
  'share/pngExport.ts',
  'theme/tokens.css',
  'ui/ColorSpectrum.tsx',
]);

function normalizedColorLiterals(source: string): string[] {
  return (source.match(COLOR_LITERAL) ?? []).map((literal) =>
    literal.toLowerCase().replaceAll(/\s+/g, ''),
  );
}

describe('the application theme tokens', () => {
  it('defines every MD3 color role in both light and dark schemes', () => {
    for (const role of COLOR_ROLES) {
      expect(tokensCss.match(new RegExp(`--md-sys-color-${role}:`, 'g'))?.length, role).toBe(2);
    }
  });

  it('defines the compact MD3 type, shape, and elevation roles', () => {
    for (const role of [
      'label-small',
      'label-medium',
      'label-large',
      'body-small',
      'body-medium',
      'body-large',
      'title-small',
      'title-medium',
      'title-large',
    ]) {
      expect(tokensCss).toContain(`--md-sys-typescale-${role}-size:`);
      expect(tokensCss).toContain(`--md-sys-typescale-${role}-line-height:`);
      expect(tokensCss).toContain(`--md-sys-typescale-${role}-weight:`);
      expect(tokensCss).toContain(`--md-sys-typescale-${role}-tracking:`);
    }
    for (const role of ['extra-small', 'small', 'medium', 'large', 'full']) {
      expect(tokensCss).toContain(`--md-sys-shape-corner-${role}:`);
    }
    for (const level of [1, 2, 3]) {
      expect(tokensCss).toContain(`--md-sys-elevation-level${level}:`);
    }
  });

  it('uses MD3 roles instead of the legacy shorthand vocabulary', () => {
    expect(appCss).toContain("@import '../theme/tokens.css';");
    expect(themeConsumerText).not.toMatch(LEGACY_TOKEN);
  });

  it('rejects unaudited color literals outside palettes, user colors, and light exports', () => {
    for (const consumer of themeConsumers) {
      if (AUDITED_COLOR_SOURCES.has(consumer.path)) continue;
      const withoutComments = consumer.source.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      expect(normalizedColorLiterals(withoutComments), consumer.path).toEqual([]);
    }

    for (const [path, allowed] of [
      ['index.html', new Set(['#ffffff', '#111310'])],
      [
        'embed.html',
        new Set([
          '#f7f4ec',
          '#111310',
          '#1e201e',
          '#0f1115',
          '#4a4e57',
          '#e6e6df',
          '#c6c7c0',
          '#92938c',
        ]),
      ],
    ] as const) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
      const unexpected = normalizedColorLiterals(source).filter((literal) => !allowed.has(literal));
      expect(unexpected, path).toEqual([]);
    }
  });
});
