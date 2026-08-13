import { resyncAutoNamedStops } from '@transitmapper/core/model/geo/crossStreetNaming';
import { materializeRouteSpans } from '@transitmapper/core/model/routeLegs';
import {
  closePatternTerminus,
  extendPatternTerminus,
} from '@transitmapper/core/model/serviceEdits';
import { replaceServicePath } from '@transitmapper/core/model/service-path-edits';
import { throughRouteServicesAt } from '@transitmapper/core/model/throughRoute';
import type { Pattern, PatternLeg, TransitSystem } from '@transitmapper/core/model/system';
import type {
  TerminusGesturePlan,
  TerminusGestureSource,
  TerminusGestureTarget,
} from '@transitmapper/core/model/serviceGestures';
import type { EditorState } from '../contracts';
import type { ServiceCommands } from '../contracts/service-commands';
import type { EditorRuntime } from '../runtime';

type ServiceGestureCommands = Pick<ServiceCommands, 'commitTerminusGesture'>;

type GestureChoice = Parameters<ServiceCommands['commitTerminusGesture']>[3];

interface GestureRequest {
  source: TerminusGestureSource;
  target: TerminusGestureTarget;
  plan: TerminusGesturePlan;
  choice: GestureChoice;
}

interface GestureCommit {
  system: TransitSystem;
  transient?: Partial<Pick<EditorState, 'selection' | 'activePatternId' | 'armedTerminus'>>;
  result: boolean;
}

function refusedGesture(state: EditorState): GestureCommit {
  return {
    system: state.system,
    transient: state.armedTerminus ? { armedTerminus: null } : undefined,
    result: false,
  };
}

function acceptedGesture(system: TransitSystem, source: TerminusGestureSource): GestureCommit {
  return {
    system,
    transient: {
      selection: { kind: 'service', id: source.serviceId },
      activePatternId: source.patternId,
      armedTerminus: null,
    },
    result: true,
  };
}

function throughRoutedSystem(request: GestureRequest): TransitSystem | null {
  const { source, target, plan } = request;
  if (plan.kind !== 'connection-choice' || request.choice !== 'through') return null;
  if (target.kind !== 'service-position' || !target.terminus) return null;
  const targetServiceId = plan.targetServiceId ?? target.serviceId;
  return throughRouteServicesAt(plan.system, source.serviceId, targetServiceId, {
    aPatternId: source.patternId,
    aEnd: source.side,
    bPatternId: target.terminus.patternId,
    bEnd: target.terminus.side,
    distanceM: 0,
  });
}

function nextGesturePattern(
  request: GestureRequest,
  pattern: Pattern,
  legs: PatternLeg[],
): Pattern | null {
  const { source, target, plan } = request;
  if (plan.kind !== 'loop' && plan.kind !== 'return') {
    return legs.length > 0 ? extendPatternTerminus(pattern, source.side, legs) : pattern;
  }
  if (target.kind !== 'service-position') return null;
  return closePatternTerminus(plan.system.ways, pattern, source.side, target.position, legs);
}

function gestureCommit(state: EditorState, request: GestureRequest): GestureCommit {
  const { source, plan, choice } = request;
  if (state.system !== plan.baseSystem || plan.kind === 'refuse') return refusedGesture(state);
  if (plan.kind === 'connection-choice' && !choice) {
    return { system: state.system, result: false };
  }
  const service = plan.system.services.find((candidate) => candidate.id === source.serviceId);
  const pattern = service?.path.id === source.patternId ? service.path : undefined;
  if (!service || !pattern) return refusedGesture(state);
  if (plan.kind === 'connection-choice' && choice === 'through') {
    const joined = throughRoutedSystem(request);
    return joined ? acceptedGesture(joined, source) : refusedGesture(state);
  }
  const legs = materializeRouteSpans(plan.system, plan.spans) ?? [];
  const nextPattern = nextGesturePattern(request, pattern, legs);
  if (!nextPattern) return refusedGesture(state);
  const nextSystem = replaceServicePath(
    plan.system,
    source.serviceId,
    source.patternId,
    nextPattern,
  );
  return acceptedGesture(
    resyncAutoNamedStops(nextSystem, new Set(legs.map((leg) => leg.wayId))),
    source,
  );
}

export function createServiceGestureCommands(runtime: EditorRuntime): ServiceGestureCommands {
  return {
    commitTerminusGesture(source, target, plan, choice) {
      return runtime.commitContent(false, (state) =>
        gestureCommit(state, { source, target, plan, choice }),
      );
    },
  };
}
