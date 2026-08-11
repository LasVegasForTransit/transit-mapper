import { renderCandidateEnvelopeBounds } from './render-candidate-envelope';
import type {
  PlanRenderPreparationOptions,
  RenderPreparedSnapshot,
} from './render-preparation-types';
import { renderViewportTransitionMarginDegrees } from './render-viewport-margin';

function sameCandidateBounds(
  left: ReturnType<typeof renderCandidateEnvelopeBounds>,
  right: ReturnType<typeof renderCandidateEnvelopeBounds>,
): boolean {
  return (
    left[0][0] === right[0][0] &&
    left[0][1] === right[0][1] &&
    left[1][0] === right[1][0] &&
    left[1][1] === right[1][1]
  );
}

/** Candidate reuse is valid only when both the effective spatial envelope and
 * the presentation-derived transition guard are unchanged. */
export function samePreparedCandidateQuery(
  current: RenderPreparedSnapshot,
  options: PlanRenderPreparationOptions,
): boolean {
  return (
    sameCandidateBounds(
      renderCandidateEnvelopeBounds(current.presentation, current.candidateEnvelope),
      renderCandidateEnvelopeBounds(options.presentation, options.candidateEnvelope),
    ) &&
    renderViewportTransitionMarginDegrees(current.presentation) ===
      renderViewportTransitionMarginDegrees(options.presentation)
  );
}
