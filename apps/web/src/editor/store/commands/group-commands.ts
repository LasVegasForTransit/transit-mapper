import { squareFootprint } from '@transitmapper/core/model/geo';
import { shortId } from '@transitmapper/core/model/ids';
import {
  addGroupFootprint,
  addGroupMember,
  createFacility,
  createGroup,
  deleteGroup,
  deleteGroupFootprint,
  moveGroupFootprintPoint,
  removeGroupMember,
  renameGroup,
  setGroupColor,
} from '@transitmapper/core/model/system';
import type { Group, LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type { GroupCommands } from '../contracts/place-commands';
import type { EditorRuntime } from '../runtime';

const GROUP_FOOTPRINT_HALF_SIZE_M = 20;

export interface GroupCommandDependencies {
  readonly readCameraCenter: () => LngLat;
}

function nextComplexColor(system: TransitSystem): string | undefined {
  const usedColors = new Set(
    system.groups.flatMap((group) => (group.color ? [group.color.toLowerCase()] : [])),
  );
  return system.palette.find((color) => !usedColors.has(color.toLowerCase())) ?? system.palette[0];
}

function createComplex(runtime: EditorRuntime, footprint: LngLat[]): string | null {
  return runtime.commitContent(null, ({ system }) => {
    const group: Group = {
      id: shortId(),
      memberIds: [],
      footprint,
      color: nextComplexColor(system),
    };
    return {
      system: { ...system, groups: [...system.groups, group] },
      transient: { selection: { kind: 'group', id: group.id } },
      result: group.id,
    };
  });
}

function placeFacility(
  runtime: EditorRuntime,
  groupId: string,
  typeId: string,
  coord: LngLat,
): string | null {
  return runtime.commitContent(null, ({ system }) => {
    if (!system.groups.some((group) => group.id === groupId)) {
      return { system, result: null };
    }
    const facility = createFacility(typeId, coord);
    const withFacility = {
      ...system,
      facilities: [...system.facilities, facility],
    };
    return {
      system: addGroupMember(withFacility, groupId, facility.id),
      transient: {
        selection: { kind: 'group', id: groupId },
        placingFacilityForGroupId: null,
        tool: 'select',
      },
      result: facility.id,
    };
  });
}

type GroupMembershipCommands = Pick<
  GroupCommands,
  | 'createGroup'
  | 'addGroupMember'
  | 'removeGroupMember'
  | 'renameGroup'
  | 'setGroupColor'
  | 'deleteGroup'
>;

function createGroupMembershipCommands(runtime: EditorRuntime): GroupMembershipCommands {
  return {
    createGroup(memberIds, name) {
      return runtime.commitContent(null, ({ system }) => {
        const group = createGroup(memberIds, name);
        return {
          system: { ...system, groups: [...system.groups, group] },
          transient: { selection: { kind: 'group', id: group.id } },
          result: group.id,
        };
      });
    },
    addGroupMember: (groupId, memberId) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: addGroupMember(system, groupId, memberId),
        result: undefined,
      })),
    removeGroupMember: (groupId, memberId) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: removeGroupMember(system, groupId, memberId),
        result: undefined,
      })),
    renameGroup: (id, name) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: renameGroup(system, id, name),
        result: undefined,
      })),
    setGroupColor: (id, color) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setGroupColor(system, id, color),
        result: undefined,
      })),
    deleteGroup: (id) =>
      runtime.commitContent(undefined, (state) => {
        const system = deleteGroup(state.system, id);
        if (system === state.system) {
          return { system: state.system, result: undefined };
        }
        return {
          system,
          transient: {
            selection:
              state.selection?.kind === 'group' && state.selection.id === id
                ? null
                : state.selection,
          },
          result: undefined,
        };
      }),
  };
}

type GroupFootprintCommands = Pick<
  GroupCommands,
  'createFacilityComplex' | 'addGroupFootprint' | 'moveGroupFootprintPoint' | 'deleteGroupFootprint'
>;

function createGroupFootprintCommands(
  runtime: EditorRuntime,
  dependencies: GroupCommandDependencies,
): GroupFootprintCommands {
  return {
    createFacilityComplex: (footprint) => createComplex(runtime, footprint),
    addGroupFootprint: (groupId) =>
      runtime.commitContent(undefined, ({ system }) => {
        const group = system.groups.find((candidate) => candidate.id === groupId);
        const next =
          group && !group.footprint
            ? addGroupFootprint(
                system,
                groupId,
                squareFootprint(dependencies.readCameraCenter(), GROUP_FOOTPRINT_HALF_SIZE_M),
              )
            : system;
        return { system: next, result: undefined };
      }),
    moveGroupFootprintPoint: (groupId, index, coord) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveGroupFootprintPoint(system, groupId, index, coord),
        result: undefined,
      })),
    deleteGroupFootprint: (groupId) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteGroupFootprint(system, groupId),
        result: undefined,
      })),
  };
}

type GroupWorkflowCommands = Pick<
  GroupCommands,
  | 'startPlacingFacility'
  | 'cancelPlacingFacility'
  | 'placeFacilityInGroup'
  | 'startPickingMember'
  | 'cancelPickingMember'
>;

function createGroupWorkflowCommands(runtime: EditorRuntime): GroupWorkflowCommands {
  return {
    startPlacingFacility(groupId) {
      const state = runtime.read();
      if (
        state.placingFacilityForGroupId === groupId &&
        state.pickingMemberForGroupId === null &&
        state.tool === 'facility'
      ) {
        return;
      }
      runtime.updateTransient({
        placingFacilityForGroupId: groupId,
        pickingMemberForGroupId: null,
        tool: 'facility',
      });
    },
    cancelPlacingFacility() {
      if (runtime.read().placingFacilityForGroupId === null) return;
      runtime.updateTransient({ placingFacilityForGroupId: null });
    },
    placeFacilityInGroup: (groupId, typeId, coord) =>
      placeFacility(runtime, groupId, typeId, coord),
    startPickingMember(groupId) {
      const state = runtime.read();
      if (
        state.pickingMemberForGroupId === groupId &&
        state.placingFacilityForGroupId === null &&
        state.tool === 'select'
      ) {
        return;
      }
      runtime.updateTransient({
        pickingMemberForGroupId: groupId,
        placingFacilityForGroupId: null,
        tool: 'select',
      });
    },
    cancelPickingMember() {
      if (runtime.read().pickingMemberForGroupId === null) return;
      runtime.updateTransient({ pickingMemberForGroupId: null });
    },
  };
}

/** Creates the group command surface once for one editor runtime. */
export function createGroupCommands(
  runtime: EditorRuntime,
  dependencies: GroupCommandDependencies,
): GroupCommands {
  return {
    ...createGroupMembershipCommands(runtime),
    ...createGroupFootprintCommands(runtime, dependencies),
    ...createGroupWorkflowCommands(runtime),
  };
}
