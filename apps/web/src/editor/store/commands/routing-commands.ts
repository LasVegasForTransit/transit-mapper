import { oneSection } from '@transitmapper/core/model/geo';
import { shortId } from '@transitmapper/core/model/ids';
import { materializeRouteSpans } from '@transitmapper/core/model/routeLegs';
import type { Line, Service } from '@transitmapper/core/model/system';
import type { RoutingCommands } from '../contracts/import-routing-commands';
import {
  DEFAULT_FREQUENCY_MINUTES,
  DEFAULT_SPAN_END,
  DEFAULT_SPAN_START,
  nextDefaultLineName,
} from '../internal-operations/service-creation';
import {
  adoptExistingInfrastructure,
  extendedRouteDraft,
  returnPathDraft,
  withReturnPath,
  withRoutedService,
  type RoutingInfrastructureOperations,
} from '../internal-operations/routing';
import type { EditorRuntime } from '../runtime';

export interface RoutingCommandOperations extends RoutingInfrastructureOperations {
  createId?: () => string;
}

type DraftCommands = Pick<
  RoutingCommands,
  | 'startRouteDraft'
  | 'extendRouteDraft'
  | 'commitRouteDraft'
  | 'cancelRouteDraft'
  | 'createRoutedService'
>;

type InfrastructureCommands = Omit<RoutingCommands, keyof DraftCommands>;

function routedServiceChange(
  state: ReturnType<EditorRuntime['read']>,
  spans: Parameters<RoutingCommands['createRoutedService']>[0],
  modeId: string,
  createId: () => string,
) {
  const legs = materializeRouteSpans(state.system, spans);
  if (!legs) return null;
  // IDs are deliberately minted after runtime.commitContent's gate and
  // after materialization proves the route is valid.
  const serviceId = createId();
  const service: Service = {
    id: serviceId,
    modeId,
    path: { id: serviceId, sections: oneSection(legs) },
    frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
    spanStart: DEFAULT_SPAN_START,
    spanEnd: DEFAULT_SPAN_END,
  };
  const lineId = createId();
  const line: Line = {
    id: lineId,
    name: nextDefaultLineName(state.system),
    color: state.draftColor,
    serviceIds: [serviceId],
  };
  return {
    system: withRoutedService(state.system, line, service),
    serviceId,
    lineId,
  };
}

function createDraftCommands(runtime: EditorRuntime, createId: () => string): DraftCommands {
  return {
    startRouteDraft(anchor) {
      runtime.updateTransient((state) => ({
        routeDraft: { modeId: state.draftModeId, lastAnchor: anchor, spans: [] },
      }));
    },
    extendRouteDraft(anchor) {
      const state = runtime.read();
      if (!state.routeDraft) return false;
      const routeDraft = extendedRouteDraft(state.system, state.routeDraft, anchor);
      if (!routeDraft) return false;
      runtime.updateTransient({ routeDraft });
      return true;
    },
    commitRouteDraft() {
      return runtime.commitContent(null, (state) => {
        const draft = state.routeDraft;
        if (!draft || draft.spans.length === 0) {
          return {
            system: state.system,
            transient: draft ? { routeDraft: null } : undefined,
            result: null,
          };
        }
        if (draft.returnFor) {
          const { serviceId, patternId } = draft.returnFor;
          const system = withReturnPath(state.system, serviceId, patternId, draft.spans);
          return {
            system,
            transient: { routeDraft: null },
            result: system === state.system ? null : serviceId,
          };
        }
        const change = routedServiceChange(state, draft.spans, draft.modeId, createId);
        return {
          system: change?.system ?? state.system,
          transient: {
            routeDraft: null,
            ...(change ? { selection: { kind: 'line' as const, id: change.lineId } } : {}),
          },
          result: change?.serviceId ?? null,
        };
      });
    },
    cancelRouteDraft() {
      runtime.updateTransient({ routeDraft: null });
    },
    createRoutedService(spans, modeId) {
      return runtime.commitContent(null, (state) => {
        const change = routedServiceChange(state, spans, modeId ?? state.draftModeId, createId);
        return {
          system: change?.system ?? state.system,
          transient: change ? { selection: { kind: 'line', id: change.lineId } } : undefined,
          result: change?.serviceId ?? null,
        };
      });
    },
  };
}

function createInfrastructureCommands(
  runtime: EditorRuntime,
  operations: RoutingCommandOperations,
): InfrastructureCommands {
  return {
    adoptExistingInfrastructure(serviceId) {
      return runtime.commitContent(0, (state) => {
        const change = adoptExistingInfrastructure(state.system, serviceId, operations);
        return { system: change.system, result: change.rebound };
      });
    },
    startReturnPathDraft(serviceId, patternId) {
      const state = runtime.read();
      const routeDraft = returnPathDraft(state.system, serviceId, patternId);
      if (!routeDraft) return false;
      runtime.updateTransient({ routeDraft });
      return true;
    },
    attachReturnPath(serviceId, patternId, spans) {
      return runtime.commitContent(false, (state) => {
        const system = withReturnPath(state.system, serviceId, patternId, spans);
        return {
          system,
          transient: system === state.system ? undefined : { routeDraft: null },
          result: system !== state.system,
        };
      });
    },
  };
}

/** Builds one stable routing command group for an editor runtime. */
export function createRoutingCommands(
  runtime: EditorRuntime,
  operations: RoutingCommandOperations,
): RoutingCommands {
  return {
    ...createDraftCommands(runtime, operations.createId ?? shortId),
    ...createInfrastructureCommands(runtime, operations),
  };
}
