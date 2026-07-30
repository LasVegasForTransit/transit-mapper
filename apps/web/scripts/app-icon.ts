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
const APPLE_GLYPH_SCALE = 1;

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
 * Icon Composer expects flat, effect-free source art and applies Liquid Glass
 * itself. The SVG preserves the exact Lucide geometry; rasterizing it once
 * below unions intersecting strokes into one alpha silhouette before Icon
 * Composer sees them.
 */
function appleTouchIconLayerSvg(): string {
  const transform = `translate(${GLYPH_OFFSET} ${GLYPH_OFFSET}) translate(12 12) scale(${APPLE_GLYPH_SCALE}) translate(-12 -12) rotate(45 12 12)`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <g
    transform="${transform}"
    fill="none"
    stroke="${LVBT.light.onPrimary}"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
      ${iconNodeMarkup(ICONS_LINE)}
  </g>
</svg>
`;
}

export async function appleTouchIconLayerPng(): Promise<Buffer> {
  return sharp(Buffer.from(appleTouchIconLayerSvg())).png({ compressionLevel: 9 }).toBuffer();
}
