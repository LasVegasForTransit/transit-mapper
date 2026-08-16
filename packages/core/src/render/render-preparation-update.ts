import type { TransitSystem } from '../model/system';
import {
  ALL_RENDER_PREPARATION_CATEGORIES,
  createRenderPreparationCoordinator,
  type RenderPreparationCoordinator,
  type RenderPreparationPlan,
} from './render-preparation';
import { renderPreparationPatchBetween } from './render-preparation-journal';
import type { RenderCandidateEnvelope } from './render-candidate-envelope';
import type { RenderPresentation } from './render-presentation';

export { createRenderPreparationCoordinator };

export interface PlanJournaledRenderPreparationOptions {
  readonly revision: string;
  readonly previous: TransitSystem;
  readonly next: TransitSystem;
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly entityChunkSize?: number;
}

/** Production entry for a committed immutable document transition. Editor
 * mutations take the exact O(delta) journal path; imports, undo, and document
 * replacement deliberately receive no patch and become cooperative cold jobs. */
export function planJournaledRenderPreparation(
  coordinator: RenderPreparationCoordinator,
  options: PlanJournaledRenderPreparationOptions,
): RenderPreparationPlan {
  const patch = renderPreparationPatchBetween(options.previous, options.next);
  return coordinator.plan({
    revision: options.revision,
    system: options.next,
    presentation: options.presentation,
    ...(options.candidateEnvelope ? { candidateEnvelope: options.candidateEnvelope } : {}),
    categories: ALL_RENDER_PREPARATION_CATEGORIES,
    ...(patch ? { patch } : {}),
    ...(options.entityChunkSize ? { entityChunkSize: options.entityChunkSize } : {}),
  });
}
