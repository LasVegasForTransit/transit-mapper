import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(new URL('../../src/theme/tokens.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../src/ui/app.css', import.meta.url), 'utf8');
const sourceRoot = new URL('../../src/', import.meta.url);

function readThemeConsumers(directory: URL): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const child = new URL(entry.name, directory.href.endsWith('/') ? directory : `${directory}/`);
      if (entry.isDirectory()) return readThemeConsumers(new URL(`${child.href}/`));
      return /\.(?:css|ts|tsx)$/.test(entry.name) ? [readFileSync(child, 'utf8')] : [];
    })
    .join('\n');
}

const themeConsumers = readThemeConsumers(sourceRoot);

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
const COLOR_LITERAL = /#[\da-f]{3,8}\b|rgba?\([^)]*\)|rgb\([^)]*\)/i;

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
    expect(themeConsumers).not.toMatch(LEGACY_TOKEN);
  });

  it('keeps palette literals in the token source rather than component styles', () => {
    const withoutComments = appCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');

    expect(withoutComments).not.toMatch(COLOR_LITERAL);
  });
});
