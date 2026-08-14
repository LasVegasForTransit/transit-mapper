/** The local renderer footprint produced by one editor content mutation. */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RenderPreparationPatch } from '@transitmapper/core/render/render-preparation';

export type EditorRenderMutation = (
  previous: TransitSystem,
  next: TransitSystem,
) => RenderPreparationPatch;
