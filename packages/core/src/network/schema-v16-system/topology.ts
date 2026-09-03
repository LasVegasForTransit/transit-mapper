import type { ResolvedTopologyWindow, ResolvedTopologyWindowCall } from '../resolved-network-chunk';
import { legacyDerivedId } from './identity';
import type { DerivedCall, DerivedLegFragment, DerivedPattern } from './patterns';

export interface DerivedWindow {
  window: ResolvedTopologyWindow;
  fragments: DerivedLegFragment[];
  calls: readonly [DerivedCall, DerivedCall, ...DerivedCall[]];
}

interface CallBoundary {
  readonly pathOrder: number;
  readonly calls: [DerivedCall, ...DerivedCall[]];
}

function callBoundaries(calls: readonly DerivedCall[]): CallBoundary[] {
  const boundaries: CallBoundary[] = [];
  for (const call of calls) {
    const previous = boundaries.at(-1);
    if (previous?.pathOrder === call.pathOrder) previous.calls.push(call);
    else boundaries.push({ pathOrder: call.pathOrder, calls: [call] });
  }
  return boundaries;
}

function boundCalls(
  boundary: CallBoundary,
  patternLegBoundaryIndex: number,
): [ResolvedTopologyWindowCall, ...ResolvedTopologyWindowCall[]] {
  const [first, ...rest] = boundary.calls;
  return [
    { stopCallId: first.id, patternLegBoundaryIndex },
    ...rest.map(({ id }) => ({ stopCallId: id, patternLegBoundaryIndex })),
  ];
}

function joinBoundaries<Type>(
  start: readonly [Type, ...Type[]],
  end: readonly [Type, ...Type[]],
): [Type, Type, ...Type[]] {
  // Each boundary has at least one call, so an interval has both endpoint calls.
  return [...start, ...end] as [Type, Type, ...Type[]];
}

function fragmentsBetweenBoundaries(
  fragments: readonly DerivedLegFragment[],
  start: CallBoundary,
  end: CallBoundary,
): DerivedLegFragment[] {
  return fragments.filter(
    (fragment) =>
      fragment.pathOrderEnd > start.pathOrder && fragment.pathOrderStart < end.pathOrder,
  );
}

export function deriveWindows(
  pattern: DerivedPattern,
  visibleIds: ReadonlySet<string>,
): DerivedWindow[] {
  const windows: DerivedWindow[] = [];
  const boundaries = callBoundaries(pattern.calls);
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const end = boundaries[index];
    const fragments = fragmentsBetweenBoundaries(pattern.fragments, start, end);
    if (fragments.length === 0 || !fragments.some((fragment) => visibleIds.has(fragment.id))) {
      continue;
    }
    const fragmentIds = fragments.map((fragment) => fragment.id);
    const calls = joinBoundaries(start.calls, end.calls);
    const anchoredCalls = joinBoundaries(boundCalls(start, 0), boundCalls(end, fragmentIds.length));
    windows.push({
      window: {
        id: legacyDerivedId(
          'topology-window',
          pattern.patternId,
          start.calls.length,
          ...start.calls.map(({ id }) => id),
          end.calls.length,
          ...end.calls.map(({ id }) => id),
        ),
        patternId: pattern.patternId,
        anchoredCalls,
        patternLegFragmentIds: [fragmentIds[0], ...fragmentIds.slice(1)],
      },
      fragments,
      calls,
    });
  }
  return windows;
}

export function addNearestBoundingCalls(
  target: Map<string, DerivedCall>,
  pattern: DerivedPattern,
  visibleFragments: readonly DerivedLegFragment[],
): void {
  for (const fragment of visibleFragments) {
    addFragmentCalls(target, pattern.calls, fragment);
  }
}

function addFragmentCalls(
  target: Map<string, DerivedCall>,
  calls: readonly DerivedCall[],
  fragment: DerivedLegFragment,
): void {
  let preceding: DerivedCall | undefined;
  let following: DerivedCall | undefined;
  for (const call of calls) {
    if (call.pathOrder <= fragment.pathOrderStart) preceding = call;
    if (following === undefined && call.pathOrder >= fragment.pathOrderEnd) following = call;
    if (call.pathOrder >= fragment.pathOrderStart && call.pathOrder <= fragment.pathOrderEnd) {
      target.set(call.id, call);
    }
  }
  if (preceding) target.set(preceding.id, preceding);
  if (following) target.set(following.id, following);
}
