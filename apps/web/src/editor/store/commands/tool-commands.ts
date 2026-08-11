import { PROFILE_PRESETS, mode, modesForWayType, wayType } from '@transitmapper/core/model/catalog';
import { modeRender } from '@transitmapper/core/style/catalogStyle';
import type { EditorState, Tool } from '../contracts';
import type { ToolCommands } from '../contracts/tool-selection-commands';
import { finishActiveWay, type WayFinishingOperations } from '../internal-operations/way-finishing';
import type { EditorRuntime } from '../runtime';

function updateIfChanged(
  runtime: EditorRuntime,
  key: Parameters<EditorRuntime['updateTransient']>[0],
): void {
  runtime.updateTransient(key);
}

type ToolSelectionCommands = Pick<ToolCommands, 'setTool' | 'setSelectVariant'>;

type ToolTransition = Partial<
  Pick<EditorState, 'tool' | 'armedTerminus' | 'multiSelection' | 'selection'>
>;

function transitionToTool(state: EditorState, tool: Tool): ToolTransition {
  if (tool !== 'lines' || state.tool === 'lines') {
    return state.tool === tool && state.armedTerminus === null ? {} : { tool, armedTerminus: null };
  }
  return {
    tool,
    armedTerminus: null,
    multiSelection: state.multiSelection.filter((item) => item.kind === 'line'),
    selection: state.selection?.kind === 'line' ? state.selection : null,
  };
}

function createToolSelectionCommands(
  runtime: EditorRuntime,
  operations: WayFinishingOperations,
): ToolSelectionCommands {
  return {
    setTool(tool) {
      const state = runtime.read();
      if (state.activeWayId === null) {
        updateIfChanged(runtime, transitionToTool(state, tool));
        return;
      }
      const finished = runtime.commitContent(false, (current) => {
        const change = finishActiveWay(current, operations);
        const finishedState = { ...current, system: change.system, ...change.transient };
        return {
          system: change.system,
          transient: { ...change.transient, ...transitionToTool(finishedState, tool) },
          result: true,
        };
      });
      if (!finished) updateIfChanged(runtime, transitionToTool(runtime.read(), tool));
    },
    setSelectVariant(variant) {
      if (runtime.read().selectVariant !== variant)
        updateIfChanged(runtime, { selectVariant: variant });
    },
  };
}

type WayDraftCommands = Pick<
  ToolCommands,
  | 'setDraftWayType'
  | 'setDraftSeparate'
  | 'setDraftMode'
  | 'setDraftGeometry'
  | 'setDraftColor'
  | 'setDraftGrade'
  | 'setDraftClassId'
  | 'setDraftPreset'
  | 'setDraftServiceEnabled'
  | 'setDraftOneWay'
>;

function createWayDraftCommands(runtime: EditorRuntime): WayDraftCommands {
  return {
    setDraftWayType(typeId) {
      const state = runtime.read();
      const compatible = modesForWayType(typeId);
      const modeId = compatible.some((candidate) => candidate.id === state.draftModeId)
        ? state.draftModeId
        : (compatible[0]?.id ?? state.draftModeId);
      updateIfChanged(runtime, {
        draftWayTypeId: typeId,
        draftModeId: modeId,
        draftColor: modeRender(modeId).color,
        draftClassId: wayType(typeId).defaultClassId,
        draftPresetId: null,
      });
    },
    setDraftSeparate(separate) {
      if (runtime.read().draftSeparate !== separate)
        updateIfChanged(runtime, { draftSeparate: separate });
    },
    setDraftMode(modeId) {
      const state = runtime.read();
      const selectedMode = mode(modeId);
      const wayTypeId = selectedMode.wayTypeIds.includes(state.draftWayTypeId)
        ? state.draftWayTypeId
        : (selectedMode.wayTypeIds[0] ?? state.draftWayTypeId);
      updateIfChanged(runtime, {
        draftModeId: modeId,
        draftWayTypeId: wayTypeId,
        draftColor: modeRender(modeId).color,
        draftClassId: wayType(wayTypeId).defaultClassId,
        draftServiceEnabled: true,
      });
    },
    setDraftGeometry(geometry) {
      if (runtime.read().draftGeometry !== geometry)
        updateIfChanged(runtime, { draftGeometry: geometry });
    },
    setDraftColor(color) {
      if (runtime.read().draftColor !== color) updateIfChanged(runtime, { draftColor: color });
    },
    setDraftGrade(grade) {
      if (runtime.read().draftGrade !== grade) updateIfChanged(runtime, { draftGrade: grade });
    },
    setDraftClassId(classId) {
      if (runtime.read().draftClassId !== classId)
        updateIfChanged(runtime, { draftClassId: classId });
    },
    setDraftPreset(presetId) {
      const state = runtime.read();
      const preset = presetId ? PROFILE_PRESETS[presetId] : undefined;
      const nextPresetId = preset ? presetId : null;
      const classId = preset?.classId ?? state.draftClassId;
      if (state.draftPresetId === nextPresetId && state.draftClassId === classId) return;
      updateIfChanged(runtime, { draftPresetId: nextPresetId, draftClassId: classId });
    },
    setDraftServiceEnabled(enabled) {
      if (runtime.read().draftServiceEnabled !== enabled)
        updateIfChanged(runtime, { draftServiceEnabled: enabled });
    },
    setDraftOneWay(on) {
      if (runtime.read().draftOneWay !== on) updateIfChanged(runtime, { draftOneWay: on });
    },
  };
}

type FacilityDraftCommands = Pick<
  ToolCommands,
  'setDraftFacilityType' | 'setDraftFacilityComplexMode' | 'addPaletteColor'
>;

function createFacilityDraftCommands(runtime: EditorRuntime): FacilityDraftCommands {
  return {
    setDraftFacilityType(typeId) {
      const state = runtime.read();
      if (state.draftFacilityTypeId === typeId && !state.draftFacilityComplexMode) return;
      updateIfChanged(runtime, { draftFacilityTypeId: typeId, draftFacilityComplexMode: false });
    },
    setDraftFacilityComplexMode(on) {
      if (runtime.read().draftFacilityComplexMode !== on) {
        updateIfChanged(runtime, { draftFacilityComplexMode: on });
      }
    },
    addPaletteColor(color) {
      if (runtime.read().system.palette.includes(color)) return;
      runtime.commitContent(undefined, (state) => ({
        system: { ...state.system, palette: [...state.system.palette, color] },
        result: undefined,
      }));
    },
  };
}

/** Builds draft-preference and tool commands around narrow workflow operations. */
export function createToolCommands(
  runtime: EditorRuntime,
  operations: WayFinishingOperations,
): ToolCommands {
  return {
    ...createToolSelectionCommands(runtime, operations),
    ...createWayDraftCommands(runtime),
    ...createFacilityDraftCommands(runtime),
  };
}
