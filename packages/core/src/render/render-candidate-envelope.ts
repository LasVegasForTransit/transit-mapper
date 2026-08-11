import type { RenderBounds, RenderPresentation } from './render-presentation';

/** Live-only spatial query policy. Unlike RenderPresentation, this may include
 * predicted camera travel and is never used for LOD, projection, or export. */
export interface RenderCandidateEnvelope {
  readonly bounds: RenderBounds;
}

export function renderCandidateEnvelopeBounds(
  presentation: RenderPresentation,
  envelope?: RenderCandidateEnvelope,
): [RenderBounds['southwest'], RenderBounds['northeast']] {
  const bounds = envelope?.bounds ?? presentation.bounds;
  return [bounds.southwest, bounds.northeast];
}
