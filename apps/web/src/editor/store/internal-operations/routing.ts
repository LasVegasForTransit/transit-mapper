import { mode } from '@transitmapper/core/model/catalog';
import { patternRunLegs, patternRunPath } from '@transitmapper/core/model/geo';
import { servicePattern } from '@transitmapper/core/model/line-service';
import {
  anchorOnWay,
  routeBetween,
  type RouteAnchor,
  type RouteSpan,
} from '@transitmapper/core/model/routeGraph';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RouteDraft } from '../state';

interface DraftSpanJoin {
  spans: RouteSpan[];
  rest: RouteSpan[];
}

function joinedDraftSpans(existing: RouteSpan[], additions: RouteSpan[]): DraftSpanJoin | null {
  const spans = existing.map((span) => ({ ...span }));
  const previous = spans[spans.length - 1];
  const first = additions[0];
  if (spans.length === 0 || first.wayId !== previous.wayId) return { spans, rest: additions };
  if (previous.noInterior && first.noInterior) {
    if (previous.seg !== first.seg || !previous.toCoord || !first.toCoord) return null;
    previous.toCoord = first.toCoord;
    return { spans, rest: additions.slice(1) };
  }
  if (previous.noInterior || first.noInterior) return null;
  const previousDirection = Math.sign(previous.toPoint - previous.fromPoint);
  const nextDirection = Math.sign(first.toPoint - first.fromPoint);
  if (!previous.toCoord || !first.fromCoord || previousDirection !== nextDirection) return null;
  previous.toPoint = first.toPoint;
  previous.toCoord = first.toCoord;
  return { spans, rest: additions.slice(1) };
}

function repeatsWay(existing: RouteSpan[], additions: RouteSpan[]): boolean {
  const seen = new Set(existing.map((span) => span.wayId));
  return additions.some((span) => {
    if (seen.has(span.wayId)) return true;
    seen.add(span.wayId);
    return false;
  });
}

/** Extends a transient route draft without mutating its existing spans. */
export function extendedRouteDraft(
  system: TransitSystem,
  draft: RouteDraft,
  anchor: RouteAnchor,
): RouteDraft | null {
  const allowed = new Set(mode(draft.modeId).wayTypeIds);
  const routed = routeBetween(system, draft.lastAnchor, anchor, {
    allowedTypeIds: allowed,
    travel: 'preferLegal',
  });
  if (!routed || routed.spans.length === 0) return null;

  const joined = joinedDraftSpans(draft.spans, routed.spans);
  if (!joined) return null;
  // Reusing a way makes the draft's direction ambiguous until couplet-aware
  // drafting exists, so reject the extension instead of silently misjoining it.
  if (repeatsWay(joined.spans, joined.rest)) return null;
  return {
    ...draft,
    lastAnchor: anchor,
    spans: [...joined.spans, ...joined.rest.map((span) => ({ ...span }))],
  };
}

/** Builds the transient return draft from the outward run's real terminus. */
export function returnPathDraft(
  system: TransitSystem,
  serviceId: string,
  patternId: string,
): RouteDraft | null {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  const pattern = service?.id === patternId ? servicePattern(service) : undefined;
  if (!service || !pattern) return null;
  const outward = patternRunPath(system.ways, pattern, 'outbound');
  if (outward.length < 2) return null;
  const run = patternRunLegs(pattern, 'outbound');
  const lastWayId = run[run.length - 1]?.leg.wayId;
  const way = system.ways.find((candidate) => candidate.id === lastWayId);
  const anchor = way ? anchorOnWay(way, outward[outward.length - 1]) : null;
  return anchor
    ? {
        modeId: service.modeId,
        lastAnchor: anchor,
        spans: [],
        returnFor: { serviceId, patternId },
      }
    : null;
}
