// The Las Vegans for Better Transit brand system, as it applies to anything
// this project renders for the outside world: share-link preview cards, the
// embeddable map, exported images.
//
// Source of truth is the brand page at lasvegasfortransit.org/brand (authored
// in the org's website repo at src/pages/brand.astro). Every value below is a
// real token from it. Nothing here is eyeballed, and nothing here should ever
// be replaced with a hand-picked near-white or near-black — that is exactly
// the mistake this module exists to prevent.
//
// Note this is NOT the same palette as TransitMapper's own editor chrome
// (apps/web/src/ui/app.css), which is a cooler ink-on-white system with its
// own typeface. Reconciling the two is tracked separately; what's settled is
// that anything leaving the app and carrying the org's name uses these.

/** Brand colors, light and dark. Token names match the brand page exactly. */
export const LVBT = {
  light: {
    surface: '#F7F4EC',
    onSurface: '#0F1115',
    onSurfaceVariant: '#4A4E57',
    surfaceContainer: '#EFE9DB',
    slab: '#0F1115',
    onSlab: '#F7F4EC',
    /** Both --color-outline and --color-outline-variant are this on light:
     *  borders in this identity are ink, never a soft grey hairline. */
    outline: '#0F1115',
    primary: '#E5471A',
    onPrimary: '#F7F4EC',
    primaryInk: '#BF3A10',
  },
  dark: {
    surface: '#191A1D',
    onSurface: '#F7F4EC',
    onSurfaceVariant: '#B0A99C',
    surfaceContainer: '#232428',
    slab: '#2D2F34',
    onSlab: '#F7F4EC',
    outline: '#72757D',
    primary: '#E5471A',
    onPrimary: '#F7F4EC',
    primaryInk: '#FF8A5C',
  },
} as const;

/** The brand typeface. Named bare (no fallback stack) where a renderer has to
 *  resolve it against bundled font data rather than system fonts. */
export const LVBT_FONT_FAMILY = 'Public Sans';

/**
 * With web-safe fallbacks, for contexts that render in a browser.
 *
 * Quoted with apostrophes, not double quotes. This string gets interpolated
 * into `font-family="…"` in generated SVG, and a double-quoted family name
 * inside a double-quoted attribute closes the attribute early and produces
 * malformed markup. CSS accepts either quoting style, so the apostrophes cost
 * nothing and the value stays safe to embed.
 */
export const LVBT_FONT_STACK = `'${LVBT_FONT_FAMILY}', system-ui, sans-serif`;
