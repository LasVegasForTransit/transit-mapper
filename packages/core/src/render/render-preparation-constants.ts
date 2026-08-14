import type { RenderViewportCategory } from './viewport-index';

export const MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY = 64;

/** Authoritative committed categories. Selection-owned handles and service
 * termini are transient editor sources and intentionally stay out of the
 * persistent document preparation index. */
export const ALL_RENDER_PREPARATION_CATEGORIES: readonly RenderViewportCategory[] = [
  'corridor',
  'junction',
  'stop',
  'station',
  'label',
  'facility',
  'group',
];
