import { modesForWayType } from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { resyncAutoNamedStations } from '@transitmapper/core/model/geo/crossStreetNaming';
import { shortId } from '@transitmapper/core/model/ids';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import {
  moveServicesToLine as moveServiceRecords,
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
  | 'moveServicesToLine'
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

type ServiceDeletionCommands = Pick<ServiceCommands, 'deleteLine' | 'deleteService'>;
type ServiceMembershipCommands = Pick<
  ServiceCommands,
  'startAddingServiceToLine' | 'cancelAddingService' | 'moveServiceToLine' | 'moveServicesToLine'
>;

function commitMoveServicesToLine(
  runtime: EditorRuntime,
  serviceIds: readonly string[],
  lineId: string,
): void {
  runtime.commitContent(undefined, (state) => {
    const movingIds = new Set(serviceIds);
    const sourceLineIds = new Set(
      state.system.lines
        .filter((line) => line.serviceIds.some((serviceId) => movingIds.has(serviceId)))
        .map((line) => line.id),
    );
    sourceLineIds.delete(lineId);
    const system = moveServiceRecords(state.system, serviceIds, lineId);
    const remainingLineIds = new Set(system.lines.map((line) => line.id));
    const selectedSourceLine =
      state.selection?.kind === 'line' &&
      sourceLineIds.has(state.selection.id) &&
      !remainingLineIds.has(state.selection.id);
    return {
      system,
      transient: selectedSourceLine ? { selection: { kind: 'line', id: lineId } } : undefined,
      result: undefined,
    };
  });
}

function createServiceDeletionCommands(runtime: EditorRuntime): ServiceDeletionCommands {
  return {
    deleteLine: (id) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'line', id }]),
        result: undefined,
      })),
    deleteService: (id) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'service', id }]),
        result: undefined,
      })),
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
      commitMoveServicesToLine(runtime, [serviceId], lineId);
    },

    moveServicesToLine(serviceIds, lineId) {
      commitMoveServicesToLine(runtime, serviceIds, lineId);
    },
  };
}

export function createServiceMetadataCommands(runtime: EditorRuntime): ServiceMetadataCommands {
  return {
    ...createServiceCreationCommands(runtime),
    ...createServicePropertyCommands(runtime),
    ...createServiceDeletionCommands(runtime),
    ...createServiceMembershipCommands(runtime),
  };
}
