import { PROFILE_PRESETS } from '@transitmapper/core/model/catalog';
import { shortId } from '@transitmapper/core/model/ids';
import { buildProfile } from '@transitmapper/core/model/profile';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import {
  closeWayLoop as closeLoopInSystem,
  deleteWayPoint as deletePointInSystem,
  insertWayPoint as insertPointInSystem,
  joinWayPointToWay as joinPointInSystem,
  moveWayPoint as movePointInSystem,
  appendWayPoint as appendPointInSystem,
  straightenWay as straightenWayInSystem,
} from '@transitmapper/core/model/way-point-edits';
import {
  nameWay as nameWayInSystem,
  renameNamedWay as renameNamedWayInSystem,
  withWayCapacity,
  withWayClass,
  withWayGeometry,
  withWayGrade,
  withWayProfile,
} from '@transitmapper/core/model/way-property-edits';
import { splitWayAtIndex, splitWayAtPosition } from '@transitmapper/core/model/way-split-edits';
import type { WayCommands } from '../contracts/way-network-commands';
import { createDraftWay, createOneWayBranch } from '../internal-operations/way-creation';
import { finishActiveWay } from '../internal-operations/way-finishing';
import type { EditorRuntime } from '../runtime';
import {
  renderMutationForWay,
  renderMutationForWayGeometry,
  renderMutationForWayJoin,
} from '../internal-operations/render-mutations';

interface WayCommandOptions {
  readonly createId?: () => string;
}

type DrawingCommands = Pick<
  WayCommands,
  'beginOneWayBranch' | 'beginWay' | 'resumeWay' | 'finishWay'
>;
type PointCommands = Pick<
  WayCommands,
  | 'addWayPoint'
  | 'insertWayPoint'
  | 'moveWayPoint'
  | 'deleteWayPoint'
  | 'joinWayPointToWay'
  | 'closeWayLoop'
  | 'straightenWay'
>;
type LifecycleCommands = Pick<WayCommands, 'deleteWay' | 'splitWayAt' | 'splitWayAtT'>;
type AttributeCommands = Omit<
  WayCommands,
  keyof DrawingCommands | keyof PointCommands | keyof LifecycleCommands
>;

function createDrawingCommands(runtime: EditorRuntime, createId: () => string): DrawingCommands {
  return {
    beginOneWayBranch(fromWayId, end) {
      return runtime.commitContent(null, (state) => {
        const change = createOneWayBranch(state, fromWayId, end, createId);
        return {
          system: change?.system ?? state.system,
          transient: change?.transient,
          result: change?.wayId ?? null,
        };
      });
    },
    beginWay(typeId, geometry, color) {
      return runtime.commitContent(null, (state) => {
        const change = createDraftWay(state, { typeId, geometry, color }, createId);
        return {
          system: change?.system ?? state.system,
          transient: change?.transient,
          result: change?.wayId ?? null,
        };
      });
    },
    resumeWay(id) {
      const state = runtime.read();
      if (state.activeWayId === id || !state.system.ways.some((way) => way.id === id)) return;
      runtime.updateTransient({ activeWayId: id });
    },
    finishWay() {
      if (!runtime.read().activeWayId) return;
      runtime.commitContent(undefined, (state) => {
        const change = finishActiveWay(state, createId);
        return { ...change, result: undefined };
      });
    },
  };
}

function createPointCommands(runtime: EditorRuntime, createId: () => string): PointCommands {
  return {
    addWayPoint(wayId, coord) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: appendPointInSystem(system, wayId, coord),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
    insertWayPoint(wayId, index, coord) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: insertPointInSystem(system, wayId, index, coord),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
    moveWayPoint(wayId, index, coord) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: movePointInSystem(system, wayId, index, coord),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
    deleteWayPoint(wayId, index) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: deletePointInSystem(system, wayId, index),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
    joinWayPointToWay(wayId, index, targetWayId, coord) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: joinPointInSystem(system, { wayId, index, targetWayId, coord }, createId),
        renderMutation: renderMutationForWayJoin(wayId, targetWayId),
        result: undefined,
      }));
    },
    closeWayLoop(wayId) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: closeLoopInSystem(system, wayId, createId),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
    straightenWay(wayId) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: straightenWayInSystem(system, wayId),
        renderMutation: renderMutationForWayGeometry(wayId),
        result: undefined,
      }));
    },
  };
}

function createLifecycleCommands(
  runtime: EditorRuntime,
  createId: () => string,
): LifecycleCommands {
  return {
    deleteWay(id) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'way', id }]),
        result: undefined,
      }));
    },
    splitWayAt(wayId, index) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: splitWayAtIndex(system, wayId, index, createId),
        result: undefined,
      }));
    },
    splitWayAtT(wayId, t) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: splitWayAtPosition(system, wayId, t, createId),
        result: undefined,
      }));
    },
  };
}

function createAttributeCommands(
  runtime: EditorRuntime,
  createId: () => string,
): AttributeCommands {
  return {
    setWayGeometry(id, geometry) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: withWayGeometry(system, id, geometry),
        renderMutation: renderMutationForWayGeometry(id),
        result: undefined,
      }));
    },
    setWayGrade(id, grade) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: withWayGrade(system, id, grade),
        renderMutation: renderMutationForWay(id),
        result: undefined,
      }));
    },
    setWayClassId(id, classId) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: withWayClass(system, id, classId),
        renderMutation: renderMutationForWay(id),
        result: undefined,
      }));
    },
    setWayCapacity(id, capacity) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: withWayCapacity(system, id, capacity, system.drivingSide),
        renderMutation: renderMutationForWayGeometry(id),
        result: undefined,
      }));
    },
    setWayProfile(id, profile) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: withWayProfile(system, id, profile),
        renderMutation: renderMutationForWayGeometry(id),
        result: undefined,
      }));
    },
    applyProfilePreset(id, presetId) {
      if (!Object.hasOwn(PROFILE_PRESETS, presetId)) return;
      const preset = PROFILE_PRESETS[presetId];
      runtime.commitContent(undefined, ({ system }) => {
        if (!system.ways.some((way) => way.id === id)) return { system, result: undefined };
        return {
          system: withWayProfile(system, id, buildProfile(preset.lanes), preset.classId),
          renderMutation: renderMutationForWayGeometry(id),
          result: undefined,
        };
      });
    },
    nameWay(wayId, value) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: nameWayInSystem(system, wayId, value, createId),
        result: undefined,
      }));
    },
    renameNamedWay(id, value) {
      runtime.commitContent(undefined, ({ system }) => ({
        system: renameNamedWayInSystem(system, id, value),
        result: undefined,
      }));
    },
  };
}

/** Builds one stable WayCommands group around the editor's guarded runtime. */
export function createWayCommands(
  runtime: EditorRuntime,
  options: WayCommandOptions = {},
): WayCommands {
  const createId = options.createId ?? shortId;
  return {
    ...createDrawingCommands(runtime, createId),
    ...createPointCommands(runtime, createId),
    ...createLifecycleCommands(runtime, createId),
    ...createAttributeCommands(runtime, createId),
  };
}
