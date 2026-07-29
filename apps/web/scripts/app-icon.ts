import sharp from 'sharp';
import { LVBT } from '@transitmapper/core/style/lvbtBrand';
import { ICON_NODES, type IconNode } from '../src/map/lucideIconNodes';

export type AppIconKind = 'regular' | 'maskable';
export type AppIconTheme = 'light' | 'dark' | 'adaptive';

export interface AppIconOptions {
  kind: AppIconKind;
  theme: AppIconTheme;
}

export interface AppIconPngOptions extends AppIconOptions {
  size: number;
}

const ICON_SIZE = 32;
const GLYPH_VIEWBOX_SIZE = 24;
const GLYPH_OFFSET = (ICON_SIZE - GLYPH_VIEWBOX_SIZE) / 2;
const GLYPH_SCALE: Record<AppIconKind, number> = {
  regular: 0.88,
  maskable: 0.62,
};

interface ThemeColors {
  background: string;
  foreground: string;
}

const THEME_COLORS: Record<Exclude<AppIconTheme, 'adaptive'>, ThemeColors> = {
  light: {
    background: LVBT.light.primary,
    foreground: LVBT.light.onPrimary,
  },
  dark: {
    background: LVBT.dark.slab,
    foreground: LVBT.dark.primaryInk,
  },
};

function attrsMarkup(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([name]) => name !== 'key')
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
}

function iconNodeMarkup(nodes: IconNode): string {
  return nodes.map(([element, attrs]) => `<${element} ${attrsMarkup(attrs)} />`).join('\n      ');
}

function adaptiveStyle(): string {
  return `<style>
    :root {
      --tm-icon-background: ${THEME_COLORS.light.background};
      --tm-icon-foreground: ${THEME_COLORS.light.foreground};
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --tm-icon-background: ${THEME_COLORS.dark.background};
        --tm-icon-foreground: ${THEME_COLORS.dark.foreground};
      }
    }
  </style>`;
}

/**
 * The install mark is the editor's real Line-tool glyph with one identity
 * transform applied. Keeping the Lucide node data as the input prevents the
 * browser tab, installed app, and toolbar from quietly becoming three
 * different drawings again.
 */
export function appIconSvg(options: AppIconOptions): string {
  const colors =
    options.theme === 'adaptive'
      ? {
          background: 'var(--tm-icon-background)',
          foreground: 'var(--tm-icon-foreground)',
        }
      : THEME_COLORS[options.theme];
  const scale = GLYPH_SCALE[options.kind];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  ${options.theme === 'adaptive' ? adaptiveStyle() : ''}
  <defs>
    <filter id="glyph-shadow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="0.6" stdDeviation="0.55" flood-color="${LVBT.light.onSurface}" flood-opacity="0.28" />
    </filter>
  </defs>
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${colors.background}" />
  <g transform="translate(${GLYPH_OFFSET} ${GLYPH_OFFSET})">
    <g
      transform="translate(12 12) scale(${scale}) translate(-12 -12) rotate(45 12 12)"
      fill="none"
      stroke="${colors.foreground}"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      filter="url(#glyph-shadow)"
    >
      ${iconNodeMarkup(ICONS_LINE)}
    </g>
  </g>
</svg>
`;
}

const ICONS_LINE = ICON_NODES.line;

function validateRasterSize(size: number): void {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('App icon size must be a positive integer.');
  }
}

export async function appIconPng(options: AppIconPngOptions): Promise<Buffer> {
  validateRasterSize(options.size);
  if (options.theme === 'adaptive') {
    throw new Error('Raster app icons require an explicit light or dark theme.');
  }

  return sharp(Buffer.from(appIconSvg(options)))
    .resize(options.size, options.size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Safari accepts a flattened Apple touch icon, not Icon Composer's layered
 * native-app format. This Apple-only rendering suggests the same material with
 * a translucent body, a restrained refracted edge, and a top-lit specular
 * highlight while the LVBT Ember field stays fully solid.
 */
export function appleTouchIconSvg(): string {
  const transform = `translate(${GLYPH_OFFSET} ${GLYPH_OFFSET}) translate(12 12) scale(${GLYPH_SCALE.regular}) translate(-12 -12) rotate(45 12 12)`;
  const nodes = iconNodeMarkup(ICONS_LINE);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <defs>
    <linearGradient id="glass-body" x1="0" y1="0" x2="0.72" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.96" />
      <stop offset="0.38" stop-color="${LVBT.light.onPrimary}" stop-opacity="0.82" />
      <stop offset="0.72" stop-color="#FFD2C4" stop-opacity="0.66" />
      <stop offset="1" stop-color="${LVBT.light.onPrimary}" stop-opacity="0.78" />
    </linearGradient>
    <linearGradient id="specular-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" />
      <stop offset="0.48" stop-color="#FFFFFF" stop-opacity="0.28" />
      <stop offset="0.7" stop-color="#000000" stop-opacity="0" />
    </linearGradient>
    <mask id="specular-mask">
      <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="url(#specular-fade)" />
    </mask>
    <filter id="glass-elevation" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="0.9" stdDeviation="0.72" flood-color="#541A0A" flood-opacity="0.34" />
    </filter>
    <filter id="refracted-edge" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="0.18" />
    </filter>
  </defs>
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${LVBT.light.primary}" />
  <g
    transform="${transform}"
    fill="none"
    stroke="#FFB39C"
    stroke-width="2.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    opacity="0.3"
    filter="url(#refracted-edge)"
  >
      ${nodes}
  </g>
  <g
    transform="${transform}"
    fill="none"
    stroke="url(#glass-body)"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    filter="url(#glass-elevation)"
  >
      ${nodes}
  </g>
  <g
    transform="${transform}"
    fill="none"
    stroke="#FFFFFF"
    stroke-width="0.58"
    stroke-linecap="round"
    stroke-linejoin="round"
    opacity="0.8"
    mask="url(#specular-mask)"
  >
      ${nodes}
  </g>
</svg>
`;
}

export async function appleTouchIconPng(size: number): Promise<Buffer> {
  validateRasterSize(size);

  return sharp(Buffer.from(appleTouchIconSvg()))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
