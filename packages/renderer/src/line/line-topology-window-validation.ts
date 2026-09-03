import {
  transitEntityKey,
  type TransitEntityKey,
} from '@transitmapper/core/model/transit-entity-ref';
import type {
  ResolvedPatternStopCall,
  ResolvedTopologyWindow,
} from '@transitmapper/core/network/resolved-network-chunk';
import { sameTransitCarrier } from '@transitmapper/core/transit/value-types';
import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import type { PreparedPatternLeg, PreparedPatternLegIndex } from './pattern-leg-index';
import type {
  PreparedTopologyWindowCall,
  PreparedTopologyWindowFragment,
  TopologyWindowPreparationFailure,
  TopologyWindowRejectionReason,
} from './line-topology-window-types';

const continuityEpsilon = 1e-9;

type RejectedTopologyWindow = Extract<
  TopologyWindowPreparationFailure,
  { readonly kind: 'rejected' }
>;

interface LogicalTraversal {
  readonly logicalId: string;
  readonly patternLeg: PreparedPatternLeg;
  nextCarrierPosition: number;
}

interface FragmentTraversalState {
  readonly completedLogicalIds: Set<string>;
  logicalTraversal?: LogicalTraversal;
  previous?: PreparedTopologyWindowFragment;
}

interface CallTraversalState {
  readonly callIds: Set<string>;
  readonly calls: PreparedTopologyWindowCall[];
  previousBoundary: number;
  previousSequence: number;
}

interface BoundaryValidation {
  readonly boundary: number;
  readonly index: number;
  readonly lastIndex: number;
  readonly fragmentCount: number;
  readonly previousBoundary: number;
}

interface PrepareAnchoredCallOptions {
  readonly projection: ResolvedNetworkProjection;
  readonly patternId: string;
  readonly anchoredCall: { readonly stopCallId: string; readonly patternLegBoundaryIndex: number };
  readonly index: number;
  readonly lastIndex: number;
  readonly fragmentCount: number;
  readonly state: CallTraversalState;
}

export type PreparedTopologyWindowFragmentsResult =
  | {
      readonly kind: 'ready';
      readonly fragments: readonly [
        PreparedTopologyWindowFragment,
        ...PreparedTopologyWindowFragment[],
      ];
    }
  | TopologyWindowPreparationFailure;

export type PreparedTopologyWindowCallsResult =
  | {
      readonly kind: 'ready';
      readonly calls: readonly [
        PreparedTopologyWindowCall,
        PreparedTopologyWindowCall,
        ...PreparedTopologyWindowCall[],
      ];
    }
  | TopologyWindowPreparationFailure;

function rejected(reason: TopologyWindowRejectionReason, recordId: string): RejectedTopologyWindow {
  return { kind: 'rejected', reason, recordId };
}

function missing(
  projection: ResolvedNetworkProjection,
  reason: TopologyWindowRejectionReason,
  recordId: string,
): TopologyWindowPreparationFailure {
  return projection.result.nextCursor === undefined
    ? { kind: 'rejected', reason, recordId }
    : { kind: 'pending', reason: 'more-pages' };
}

function samePosition(left: number, right: number): boolean {
  return Math.abs(left - right) <= continuityEpsilon;
}

function travelStart(patternLeg: PreparedPatternLeg): number {
  const range = patternLeg.logical.logicalCarrierRange;
  return patternLeg.logical.direction === 'forward' ? range[0] : range[1];
}

function travelEnd(patternLeg: PreparedPatternLeg): number {
  const range = patternLeg.logical.logicalCarrierRange;
  return patternLeg.logical.direction === 'forward' ? range[1] : range[0];
}

function shardTravelStart(fragment: PreparedTopologyWindowFragment): number {
  const range = fragment.shard.fragment.carrierRange;
  return fragment.patternLeg.logical.direction === 'forward' ? range[0] : range[1];
}

function shardTravelEnd(fragment: PreparedTopologyWindowFragment): number {
  const range = fragment.shard.fragment.carrierRange;
  return fragment.patternLeg.logical.direction === 'forward' ? range[1] : range[0];
}

function validPathAnchor(anchor: NonNullable<ResolvedPatternStopCall['pathAnchor']>): boolean {
  return (
    Number.isSafeInteger(anchor.legIndex) &&
    anchor.legIndex >= 0 &&
    Number.isFinite(anchor.carrierPosition) &&
    anchor.carrierPosition >= 0 &&
    anchor.carrierPosition <= 1
  );
}

function entityKey(kind: 'stop' | 'station', id: string): TransitEntityKey | undefined {
  try {
    return transitEntityKey({ kind, id });
  } catch {
    return undefined;
  }
}

function prepareTopologyWindowCall(
  projection: ResolvedNetworkProjection,
  patternId: string,
  stopCallId: string,
  patternLegBoundaryIndex: number,
):
  | { readonly kind: 'ready'; readonly call: PreparedTopologyWindowCall }
  | TopologyWindowPreparationFailure {
  const call = projection.index.stopCallsById.get(stopCallId);
  if (call === undefined) return missing(projection, 'missing-topology-call', stopCallId);
  if (call.patternId !== patternId) return rejected('mismatched-topology-call-pattern', call.id);
  if (call.pathAnchor === undefined) return rejected('missing-topology-call-anchor', call.id);
  if (!validPathAnchor(call.pathAnchor)) return rejected('invalid-topology-call-anchor', call.id);
  const stop = projection.index.stopsById.get(call.stopId);
  if (stop === undefined) return missing(projection, 'missing-topology-stop', call.stopId);
  const stopKey = entityKey('stop', stop.id);
  if (stopKey === undefined) return rejected('invalid-topology-stop-id', stop.id);
  if (stop.stationId === undefined) {
    return {
      kind: 'ready',
      call: {
        stopCallId: call.id,
        sequence: call.sequence,
        patternLegBoundaryIndex,
        pathAnchor: call.pathAnchor,
        stopKey,
      },
    };
  }
  const station = projection.index.stationsById.get(stop.stationId);
  if (station === undefined) return missing(projection, 'missing-topology-station', stop.stationId);
  const stationKey = entityKey('station', station.id);
  if (stationKey === undefined) return rejected('invalid-topology-station-id', station.id);
  return {
    kind: 'ready',
    call: {
      stopCallId: call.id,
      sequence: call.sequence,
      patternLegBoundaryIndex,
      pathAnchor: call.pathAnchor,
      stopKey,
      stationKey,
    },
  };
}

function prepareTopologyWindowFragment(
  projection: ResolvedNetworkProjection,
  patternLegIndex: PreparedPatternLegIndex,
  patternId: string,
  fragmentId: string,
):
  | { readonly kind: 'ready'; readonly fragment: PreparedTopologyWindowFragment }
  | TopologyWindowPreparationFailure {
  const indexed = patternLegIndex.patternLegShardsById.get(fragmentId);
  if (indexed === undefined) return missing(projection, 'missing-topology-fragment', fragmentId);
  if (indexed.patternLeg.logical.patternId !== patternId) {
    return rejected('mismatched-topology-fragment-pattern', fragmentId);
  }
  return {
    kind: 'ready',
    fragment: { fragmentId, patternLeg: indexed.patternLeg, shard: indexed.shard },
  };
}

function validateFragmentTransition(
  previous: PreparedTopologyWindowFragment,
  current: PreparedTopologyWindowFragment,
): RejectedTopologyWindow | undefined {
  const previousLeg = previous.patternLeg.logical;
  const currentLeg = current.patternLeg.logical;
  if (currentLeg.legIndex < previousLeg.legIndex) {
    return rejected('nonmonotonic-topology-fragment-order', current.fragmentId);
  }
  if (currentLeg.legIndex !== previousLeg.legIndex) return undefined;
  if (
    currentLeg.direction !== previousLeg.direction ||
    currentLeg.alignmentId !== previousLeg.alignmentId ||
    !sameTransitCarrier(currentLeg.carrier, previousLeg.carrier)
  ) {
    return rejected('conflicting-topology-fragment-leg', current.fragmentId);
  }
  return samePosition(shardTravelStart(current), shardTravelEnd(previous))
    ? undefined
    : rejected('topology-fragment-discontinuity', current.fragmentId);
}

function finishLogicalTraversal(
  traversal: LogicalTraversal,
  recordId: string,
): RejectedTopologyWindow | undefined {
  return samePosition(traversal.nextCarrierPosition, travelEnd(traversal.patternLeg))
    ? undefined
    : rejected('topology-fragment-discontinuity', recordId);
}

function startLogicalTraversal(
  state: FragmentTraversalState,
  fragment: PreparedTopologyWindowFragment,
): LogicalTraversal | RejectedTopologyWindow {
  const { logical } = fragment.patternLeg;
  if (state.completedLogicalIds.has(logical.id)) {
    return rejected('nonmonotonic-topology-fragment-order', fragment.fragmentId);
  }
  if (!samePosition(shardTravelStart(fragment), travelStart(fragment.patternLeg))) {
    return rejected('topology-fragment-discontinuity', fragment.fragmentId);
  }
  state.completedLogicalIds.add(logical.id);
  return {
    logicalId: logical.id,
    patternLeg: fragment.patternLeg,
    nextCarrierPosition: shardTravelEnd(fragment),
  };
}

function continueLogicalTraversal(
  traversal: LogicalTraversal,
  fragment: PreparedTopologyWindowFragment,
): RejectedTopologyWindow | undefined {
  if (!samePosition(shardTravelStart(fragment), traversal.nextCarrierPosition)) {
    return rejected('topology-fragment-discontinuity', fragment.fragmentId);
  }
  traversal.nextCarrierPosition = shardTravelEnd(fragment);
  return undefined;
}

function finishActiveLogicalTraversal(
  state: FragmentTraversalState,
): RejectedTopologyWindow | undefined {
  const traversal = state.logicalTraversal;
  const previous = state.previous;
  return traversal === undefined || previous === undefined
    ? undefined
    : finishLogicalTraversal(traversal, previous.fragmentId);
}

function advanceFragmentTraversal(
  state: FragmentTraversalState,
  fragment: PreparedTopologyWindowFragment,
): RejectedTopologyWindow | undefined {
  if (state.previous !== undefined) {
    const transition = validateFragmentTransition(state.previous, fragment);
    if (transition !== undefined) return transition;
  }
  if (state.logicalTraversal?.logicalId === fragment.patternLeg.logical.id) {
    const continuation = continueLogicalTraversal(state.logicalTraversal, fragment);
    if (continuation !== undefined) return continuation;
  } else {
    const completed = finishActiveLogicalTraversal(state);
    if (completed !== undefined) return completed;
    const started = startLogicalTraversal(state, fragment);
    if ('kind' in started) return started;
    state.logicalTraversal = started;
  }
  state.previous = fragment;
  return undefined;
}

function validateTopologyWindowFragments(
  fragments: readonly [PreparedTopologyWindowFragment, ...PreparedTopologyWindowFragment[]],
): RejectedTopologyWindow | undefined {
  const state: FragmentTraversalState = { completedLogicalIds: new Set() };
  for (const fragment of fragments) {
    const rejection = advanceFragmentTraversal(state, fragment);
    if (rejection !== undefined) return rejection;
  }
  return finishActiveLogicalTraversal(state);
}

function invalidBoundary(options: BoundaryValidation): boolean {
  const { boundary, index, lastIndex, fragmentCount, previousBoundary } = options;
  return (
    !Number.isSafeInteger(boundary) ||
    boundary < 0 ||
    boundary > fragmentCount ||
    (index === 0 && boundary !== 0) ||
    (index === lastIndex && boundary !== fragmentCount) ||
    boundary < previousBoundary
  );
}

function invalidSequence(sequence: number, previousSequence: number): boolean {
  return !Number.isSafeInteger(sequence) || sequence < 0 || sequence <= previousSequence;
}

function prepareAnchoredCall(
  options: PrepareAnchoredCallOptions,
): TopologyWindowPreparationFailure | undefined {
  const { projection, patternId, anchoredCall, index, lastIndex, fragmentCount, state } = options;
  const { stopCallId, patternLegBoundaryIndex } = anchoredCall;
  if (state.callIds.has(stopCallId)) return rejected('duplicate-topology-call', stopCallId);
  if (
    invalidBoundary({
      boundary: patternLegBoundaryIndex,
      index,
      lastIndex,
      fragmentCount,
      previousBoundary: state.previousBoundary,
    })
  ) {
    return rejected('invalid-topology-boundary', stopCallId);
  }
  const prepared = prepareTopologyWindowCall(
    projection,
    patternId,
    stopCallId,
    patternLegBoundaryIndex,
  );
  if (prepared.kind !== 'ready') return prepared;
  if (invalidSequence(prepared.call.sequence, state.previousSequence)) {
    return rejected('nonmonotonic-topology-call-sequence', stopCallId);
  }
  state.callIds.add(stopCallId);
  state.calls.push(prepared.call);
  state.previousBoundary = patternLegBoundaryIndex;
  state.previousSequence = prepared.call.sequence;
  return undefined;
}

export function prepareTopologyWindowFragments(
  projection: ResolvedNetworkProjection,
  patternLegIndex: PreparedPatternLegIndex,
  window: ResolvedTopologyWindow,
): PreparedTopologyWindowFragmentsResult {
  if (window.patternLegFragmentIds.length === 0) {
    return rejected('invalid-topology-window', window.id);
  }
  const fragmentIds = new Set<string>();
  const fragments: PreparedTopologyWindowFragment[] = [];
  for (const fragmentId of window.patternLegFragmentIds) {
    if (fragmentIds.has(fragmentId)) return rejected('duplicate-topology-fragment', fragmentId);
    fragmentIds.add(fragmentId);
    const prepared = prepareTopologyWindowFragment(
      projection,
      patternLegIndex,
      window.patternId,
      fragmentId,
    );
    if (prepared.kind !== 'ready') return prepared;
    fragments.push(prepared.fragment);
  }
  const typedFragments = fragments as [
    PreparedTopologyWindowFragment,
    ...PreparedTopologyWindowFragment[],
  ];
  const rejection = validateTopologyWindowFragments(typedFragments);
  return rejection ?? { kind: 'ready', fragments: typedFragments };
}

export function prepareTopologyWindowCalls(
  projection: ResolvedNetworkProjection,
  patternId: string,
  anchoredCalls: readonly {
    readonly stopCallId: string;
    readonly patternLegBoundaryIndex: number;
  }[],
  fragmentCount: number,
): PreparedTopologyWindowCallsResult {
  if (anchoredCalls.length < 2) return rejected('invalid-topology-window', patternId);
  const state: CallTraversalState = {
    callIds: new Set(),
    calls: [],
    previousBoundary: -1,
    previousSequence: -1,
  };
  for (const [index, anchoredCall] of anchoredCalls.entries()) {
    const rejection = prepareAnchoredCall({
      projection,
      patternId,
      anchoredCall,
      index,
      lastIndex: anchoredCalls.length - 1,
      fragmentCount,
      state,
    });
    if (rejection !== undefined) return rejection;
  }
  return {
    kind: 'ready',
    calls: state.calls as [
      PreparedTopologyWindowCall,
      PreparedTopologyWindowCall,
      ...PreparedTopologyWindowCall[],
    ],
  };
}
