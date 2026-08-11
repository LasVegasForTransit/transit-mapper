import type { TransitSystem } from '../model/system';
import {
  renderCandidateEnvelopeBounds,
  type RenderCandidateEnvelope,
} from './render-candidate-envelope';
import type { RenderPresentation } from './render-presentation';
import { renderViewportTransitionMarginDegrees } from './render-viewport-margin';
import {
  queryViewportCandidates,
  viewportIndexFor,
  type RenderViewportCategory,
} from './viewport-index';

export interface RenderViewportCandidateSets {
  wayIds?: readonly string[];
  wayIdSet?: ReadonlySet<string>;
  junctionIds?: readonly string[];
  stationIds?: readonly string[];
  labelIds?: readonly string[];
  wayHandleIds?: readonly string[];
  serviceTerminusIds?: readonly string[];
  facilityIds?: readonly string[];
  groupIds?: readonly string[];
  physicalHandleIds?: readonly string[];
}

/** Convert the immutable index's compact ID arrays into the sets consumed by
 * the projection stages. Keeping camera math here prevents document-derived
 * topology projection from owning presentation-specific invalidation logic. */
export function renderViewportCandidateSets(
  system: TransitSystem,
  presentation: RenderPresentation | undefined,
  categories: readonly RenderViewportCategory[],
  candidateEnvelope?: RenderCandidateEnvelope,
): RenderViewportCandidateSets {
  if (!presentation) return {};
  const candidates = queryViewportCandidates(viewportIndexFor(system), {
    bounds: renderCandidateEnvelopeBounds(presentation, candidateEnvelope),
    transitionMarginDegrees: renderViewportTransitionMarginDegrees(presentation),
    categories,
  });

  return {
    wayIds: candidates.corridorIds,
    wayIdSet: new Set(candidates.corridorIds),
    junctionIds: candidates.junctionIds,
    stationIds: candidates.stationIds,
    labelIds: candidates.labelIds,
    wayHandleIds: candidates.wayHandleIds,
    serviceTerminusIds: candidates.serviceTerminusIds,
    facilityIds: candidates.facilityIds,
    groupIds: candidates.groupIds,
    physicalHandleIds: candidates.physicalHandleIds,
  };
}
