import { modesForWayType } from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { resyncAutoNamedStations } from '@transitmapper/core/model/geo/crossStreetNaming';
import { shortId } from '@transitmapper/core/model/ids';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import {
  moveServiceToLine as moveServiceRecord,
  setLineColor,
  setLineName,
  setServiceFrequency,
  setServiceMode,
  setServiceName,
  setServiceSchedule,
  setServiceSpan,
  setServiceVehicleKind,
  setVehicleKinds as setVehicleKindRecords,
} from '@transitmapper/core/model/system';
import type { Line, Service, TransitSystem } from '@transitmapper/core/model/system';
import type { EditorState } from '../contracts';
import type { ServiceCommands } from '../contracts/service-commands';
import {
  DEFAULT_FREQUENCY_MINUTES,
  DEFAULT_SPAN_END,
  DEFAULT_SPAN_START,
  nextDefaultLineName,
  unusedPaletteColor,
} from '../internal-operations/service-creation';
import type { EditorRuntime } from '../runtime';

type ServiceMetadataCommands = Pick<
  ServiceCommands,
  | 'addServiceToWay'
  | 'setLineName'
  | 'setLineColor'
  | 'deleteLine'
  | 'setServiceName'
  | 'setServiceMode'
  | 'setServiceFrequency'
  | 'setServiceSpan'
  | 'setServiceSchedule'
  | 'setVehicleKinds'
  | 'setServiceVehicleKind'
  | 'deleteService'
  | 'startAddingServiceToLine'
  | 'cancelAddingService'
  | 'moveServiceToLine'
>;

function commitServiceChange(
  runtime: EditorRuntime,
  transform: (system: TransitSystem) => TransitSystem,
): void {
  runtime.commitContent(undefined, (state) => ({
    system: transform(state.system),
    result: undefined,
  }));
}

type ServiceCreationCommands = Pick<ServiceCommands, 'addServiceToWay'>;

function createServiceCreationCommands(runtime: EditorRuntime): ServiceCreationCommands {
  return {
    addServiceToWay(wayId) {
      return runtime.commitContent<string | null>(null, (state) => {
        const way = state.system.ways.find((candidate) => candidate.id === wayId);
        if (!way) return { system: state.system, result: null };
        const compatible = modesForWayType(way.typeId);
        if (compatible.length === 0) return { system: state.system, result: null };
        const modeId = compatible.some((candidate) => candidate.id === state.draftModeId)
          ? state.draftModeId
          : compatible[0].id;
        const serviceId = shortId();
        const lineId = shortId();
        const color = unusedPaletteColor(state.system, modeId);
        const service: Service = {
          id: serviceId,
          modeId,
          path: { id: serviceId, sections: oneSection([wholeLeg(wayId)]) },
          frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
          spanStart: DEFAULT_SPAN_START,
          spanEnd: DEFAULT_SPAN_END,
        };
        const line: Line = {
          id: lineId,
          name: nextDefaultLineName(state.system),
          color,
          serviceIds: [serviceId],
        };
        const withNewLine: TransitSystem = {
          ...state.system,
          lines: [...state.system.lines, line],
          services: [...state.system.services, service],
        };
        return {
          system: resyncAutoNamedStations(withNewLine, new Set([wayId])),
          transient: { selection: { kind: 'line', id: lineId } },
          result: serviceId,
        };
      });
    },
  };
}

type ServicePropertyCommands = Pick<
  ServiceCommands,
  | 'setLineName'
  | 'setLineColor'
  | 'setServiceName'
  | 'setServiceMode'
  | 'setServiceFrequency'
  | 'setServiceSpan'
  | 'setServiceSchedule'
  | 'setVehicleKinds'
  | 'setServiceVehicleKind'
>;

function createServicePropertyCommands(runtime: EditorRuntime): ServicePropertyCommands {
  const commit = (transform: (system: TransitSystem) => TransitSystem): void => {
    commitServiceChange(runtime, transform);
  };
  return {
    setLineName(id, name) {
      commit((system) => setLineName(system, id, name));
    },

    setLineColor(id, color) {
      commit((system) => setLineColor(system, id, color));
    },

    setServiceName(id, name) {
      commit((system) => setServiceName(system, id, name));
    },

    setServiceMode(id, modeId) {
      commit((system) => setServiceMode(system, id, modeId));
    },

    setServiceFrequency(id, frequencyMinutes) {
      commit((system) => setServiceFrequency(system, id, frequencyMinutes));
    },

    setServiceSpan(id, spanStart, spanEnd) {
      commit((system) => setServiceSpan(system, id, spanStart, spanEnd));
    },

    setServiceSchedule(id, periods) {
      commit((system) => setServiceSchedule(system, id, periods));
    },

    setVehicleKinds(kinds) {
      commit((system) => setVehicleKindRecords(system, kinds));
    },

    setServiceVehicleKind(id, vehicleKindId) {
      commit((system) => setServiceVehicleKind(system, id, vehicleKindId));
    },
  };
}

type ServiceLifecycleCommands = Pick<
  ServiceCommands,
  | 'deleteLine'
  | 'deleteService'
  | 'startAddingServiceToLine'
  | 'cancelAddingService'
  | 'moveServiceToLine'
>;

type ServiceDeletionCommands = Pick<ServiceCommands, 'deleteLine' | 'deleteService'>;
type ServiceMembershipCommands = Omit<ServiceLifecycleCommands, keyof ServiceDeletionCommands>;

function referencesRemovedLine(
  selection: EditorState['selection'],
  lineId: string,
  serviceIds: ReadonlySet<string>,
): boolean {
  return (
    (selection?.kind === 'line' && selection.id === lineId) ||
    (selection?.kind === 'service' && serviceIds.has(selection.id))
  );
}

function withoutRemovedLineSelections(
  selections: EditorState['multiSelection'],
  lineId: string,
  serviceIds: ReadonlySet<string>,
): EditorState['multiSelection'] {
  const remaining = selections.filter(
    (selection) => !referencesRemovedLine(selection, lineId, serviceIds),
  );
  return remaining.length === selections.length ? selections : remaining;
}

function createServiceDeletionCommands(runtime: EditorRuntime): ServiceDeletionCommands {
  return {
    deleteLine(id) {
      runtime.commitContent(undefined, (state) => {
        const line = state.system.lines.find((candidate) => candidate.id === id);
        if (!line) return { system: state.system, result: undefined };
        const serviceIds = new Set(line.serviceIds);
        const patternIds = new Set(
          state.system.services
            .filter((service) => serviceIds.has(service.id))
            .map((service) => service.path.id),
        );
        const system = deleteSelection(state.system, [{ kind: 'line', id }]);
        return {
          system,
          transient: {
            selection: referencesRemovedLine(state.selection, id, serviceIds)
              ? null
              : state.selection,
            outlineHover: referencesRemovedLine(state.outlineHover, id, serviceIds)
              ? null
              : state.outlineHover,
            multiSelection: withoutRemovedLineSelections(state.multiSelection, id, serviceIds),
            activePatternId:
              state.activePatternId && patternIds.has(state.activePatternId)
                ? null
                : state.activePatternId,
            armedTerminus:
              state.armedTerminus && serviceIds.has(state.armedTerminus.serviceId)
                ? null
                : state.armedTerminus,
            addingServiceDraft:
              state.addingServiceDraft?.lineId === id ? null : state.addingServiceDraft,
            routeDraft:
              state.routeDraft?.returnFor && serviceIds.has(state.routeDraft.returnFor.serviceId)
                ? null
                : state.routeDraft,
          },
          result: undefined,
        };
      });
    },

    deleteService(id) {
      runtime.commitContent(undefined, (state) => {
        const removed = state.system.services.find((service) => service.id === id);
        const system = deleteSelection(state.system, [{ kind: 'service', id }]);
        if (!removed || system === state.system) return { system: state.system, result: undefined };
        return {
          system,
          transient: {
            selection:
              state.selection?.kind === 'service' && state.selection.id === id
                ? null
                : state.selection,
            activePatternId:
              state.activePatternId === removed.path.id ? null : state.activePatternId,
            armedTerminus: state.armedTerminus?.serviceId === id ? null : state.armedTerminus,
          },
          result: undefined,
        };
      });
    },
  };
}

function createServiceMembershipCommands(runtime: EditorRuntime): ServiceMembershipCommands {
  return {
    startAddingServiceToLine(lineId, details) {
      runtime.updateTransient({
        addingServiceDraft: {
          lineId,
          name: details.name.trim(),
          modeId: details.modeId,
        },
        tool: 'way',
      });
    },

    cancelAddingService() {
      runtime.updateTransient({ addingServiceDraft: null });
    },

    moveServiceToLine(serviceId, lineId) {
      runtime.commitContent(undefined, (state) => {
        const sourceLine = state.system.lines.find((line) => line.serviceIds.includes(serviceId));
        const system = moveServiceRecord(state.system, serviceId, lineId);
        if (!sourceLine || system.lines.some((line) => line.id === sourceLine.id)) {
          return { system, result: undefined };
        }
        return {
          system,
          transient: {
            selection:
              state.selection?.kind === 'line' && state.selection.id === sourceLine.id
                ? { kind: 'line', id: lineId }
                : state.selection,
            outlineHover:
              state.outlineHover?.kind === 'line' && state.outlineHover.id === sourceLine.id
                ? null
                : state.outlineHover,
            multiSelection: state.multiSelection.filter(
              (selection) => selection.kind !== 'line' || selection.id !== sourceLine.id,
            ),
            addingServiceDraft:
              state.addingServiceDraft?.lineId === sourceLine.id ? null : state.addingServiceDraft,
          },
          result: undefined,
        };
      });
    },
  };
}

function createServiceLifecycleCommands(runtime: EditorRuntime): ServiceLifecycleCommands {
  return {
    ...createServiceDeletionCommands(runtime),
    ...createServiceMembershipCommands(runtime),
  };
}

export function createServiceMetadataCommands(runtime: EditorRuntime): ServiceMetadataCommands {
  return {
    ...createServiceCreationCommands(runtime),
    ...createServicePropertyCommands(runtime),
    ...createServiceLifecycleCommands(runtime),
  };
}
