import {
  combineCarriageways,
  separateCarriageways,
  withMedianWidth,
} from '@transitmapper/core/model/carriageway-edits';
import { mergeWaysIntoCorridor } from '@transitmapper/core/model/corridor-merge-edits';
import { formCrossingJunctions } from '@transitmapper/core/model/crossing-edits';
import { shortId } from '@transitmapper/core/model/ids';
import {
  disconnectNodeWay,
  setApproachControl,
  setDrivingSide,
  setNodeConnectors,
  setNodeControl,
  setTurnRestriction,
} from '@transitmapper/core/model/network-node-edits';
import { mergeWaysEndToEnd } from '@transitmapper/core/model/way-merge-edits';
import { deleteWayStretch } from '@transitmapper/core/model/way-stretch-edits';
import type { NetworkCommands } from '../contracts/way-network-commands';
import type { EditorRuntime } from '../runtime';

interface NetworkCommandOptions {
  readonly createId?: () => string;
}

type NodeCommands = Pick<
  NetworkCommands,
  | 'setNodeControl'
  | 'setNodeConnectors'
  | 'disconnectNodeWay'
  | 'setApproachControl'
  | 'setTurnRestriction'
  | 'setDrivingSide'
>;

type StructureCommands = Omit<NetworkCommands, keyof NodeCommands>;

function createNodeCommands(runtime: EditorRuntime): NodeCommands {
  return {
    setNodeControl(nodeId, control) {
      runtime.commitContent(undefined, (state) => ({
        system: setNodeControl(state.system, nodeId, control),
        result: undefined,
      }));
    },
    setNodeConnectors(nodeId, connectors) {
      runtime.commitContent(undefined, (state) => ({
        system: setNodeConnectors(state.system, nodeId, connectors),
        result: undefined,
      }));
    },
    disconnectNodeWay(nodeId, wayId) {
      runtime.commitContent(undefined, (state) => {
        const system = disconnectNodeWay(state.system, nodeId, wayId);
        const nodeSurvives = system.nodes.some((node) => node.id === nodeId);
        const clearSelection =
          !nodeSurvives && state.selection?.kind === 'node' && state.selection.id === nodeId;
        return {
          system,
          transient: clearSelection ? { selection: null } : undefined,
          result: undefined,
        };
      });
    },
    setApproachControl(wayId, end, control) {
      runtime.commitContent(undefined, (state) => ({
        system: setApproachControl(state.system, wayId, end, control),
        result: undefined,
      }));
    },
    setTurnRestriction(wayId, laneId, allowedTargets) {
      runtime.commitContent(undefined, (state) => ({
        system: setTurnRestriction(state.system, wayId, laneId, allowedTargets),
        result: undefined,
      }));
    },
    setDrivingSide(side) {
      runtime.commitContent(undefined, (state) => ({
        system: setDrivingSide(state.system, side),
        result: undefined,
      }));
    },
  };
}

function createStructureCommands(
  runtime: EditorRuntime,
  createId: () => string,
): StructureCommands {
  return {
    formCrossingJunctions(wayId, onlyWithWayId) {
      runtime.commitContent(undefined, (state) => ({
        system: formCrossingJunctions(state.system, wayId, onlyWithWayId, createId),
        result: undefined,
      }));
    },
    mergeWays(keepWayId, otherWayId) {
      runtime.commitContent(undefined, (state) => {
        const system = mergeWaysEndToEnd(state.system, keepWayId, otherWayId);
        const selectedOther =
          system !== state.system &&
          state.selection?.kind === 'way' &&
          state.selection.id === otherWayId;
        return {
          system,
          transient: selectedOther ? { selection: { kind: 'way', id: keepWayId } } : undefined,
          result: undefined,
        };
      });
    },
    separateCarriageways(wayId) {
      return runtime.commitContent(null, (state) => {
        const change = separateCarriageways(state.system, wayId, createId);
        return {
          system: change?.system ?? state.system,
          result: change?.newWayId ?? null,
        };
      });
    },
    combineCarriageways(namedWayId) {
      runtime.commitContent(undefined, (state) => {
        const system = combineCarriageways(state.system, namedWayId);
        const keeperId = system.namedWays.find((namedWay) => namedWay.id === namedWayId)?.wayIds[0];
        return {
          system,
          transient:
            system !== state.system && keeperId
              ? { selection: { kind: 'way', id: keeperId } }
              : undefined,
          result: undefined,
        };
      });
    },
    setMedianWidth(namedWayId, widthM) {
      runtime.commitContent(undefined, (state) => ({
        system: withMedianWidth(state.system, namedWayId, widthM),
        result: undefined,
      }));
    },
    deleteWayStretch(wayId, fromT, toT) {
      return runtime.commitContent(0, (state) => {
        const change = deleteWayStretch(state.system, {
          wayId,
          fromT,
          toT,
          createId,
        });
        return { system: change.system, result: change.affectedPatterns };
      });
    },
    mergeWaysIntoCorridor(wayIds) {
      return runtime.commitContent(0, (state) => {
        const change = mergeWaysIntoCorridor(state.system, wayIds);
        return {
          system: change.system,
          transient: change.absorbed > 0 ? { multiSelection: [], selection: null } : undefined,
          result: change.absorbed,
        };
      });
    },
  };
}

/** Builds the complete stable network command group for one editor runtime. */
export function createNetworkCommands(
  runtime: EditorRuntime,
  options: NetworkCommandOptions = {},
): NetworkCommands {
  return {
    ...createNodeCommands(runtime),
    ...createStructureCommands(runtime, options.createId ?? shortId),
  };
}
