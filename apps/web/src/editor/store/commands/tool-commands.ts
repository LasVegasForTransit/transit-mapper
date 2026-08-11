import { PROFILE_PRESETS, mode, modesForWayType, wayType } from '@transitmapper/core/model/catalog';
import { shortId } from '@transitmapper/core/model/ids';
import { modeRender } from '@transitmapper/core/style/catalogStyle';
import type { EditorState, Tool } from '../contracts';
import type { ToolCommands } from '../contracts/tool-selection-commands';
import { finishActiveWay } from '../internal-operations/way-finishing';
import type { EditorRuntime } from '../runtime';

interface ToolCommandOptions {
  readonly createId?: () => string;
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
  createId: () => string,
): ToolSelectionCommands {
  return {
    setTool(tool) {
      const state = runtime.read();
      if (state.activeWayId === null) {
        runtime.updateTransient(transitionToTool(state, tool));
        return;
      }
      const finished = runtime.commitContent(false, (current) => {
        const change = finishActiveWay(current, createId);
        const finishedState = { ...current, system: change.system, ...change.transient };
        return {
          system: change.system,
          transient: { ...change.transient, ...transitionToTool(finishedState, tool) },
          result: true,
        };
      });
      if (!finished) runtime.updateTransient(transitionToTool(runtime.read(), tool));
    },
    setSelectVariant(variant) {
      runtime.updateTransient({ selectVariant: variant });
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
      runtime.updateTransient({
        draftWayTypeId: typeId,
        draftModeId: modeId,
        draftColor: modeRender(modeId).color,
        draftClassId: wayType(typeId).defaultClassId,
        draftPresetId: null,
      });
    },
    setDraftSeparate(separate) {
      runtime.updateTransient({ draftSeparate: separate });
    },
    setDraftMode(modeId) {
      const state = runtime.read();
      const selectedMode = mode(modeId);
      const wayTypeId = selectedMode.wayTypeIds.includes(state.draftWayTypeId)
        ? state.draftWayTypeId
        : (selectedMode.wayTypeIds[0] ?? state.draftWayTypeId);
      runtime.updateTransient({
        draftModeId: modeId,
        draftWayTypeId: wayTypeId,
        draftColor: modeRender(modeId).color,
        draftClassId: wayType(wayTypeId).defaultClassId,
        draftServiceEnabled: true,
      });
    },
    setDraftGeometry(geometry) {
      runtime.updateTransient({ draftGeometry: geometry });
    },
    setDraftColor(color) {
      runtime.updateTransient({ draftColor: color });
    },
    setDraftGrade(grade) {
      runtime.updateTransient({ draftGrade: grade });
    },
    setDraftClassId(classId) {
      runtime.updateTransient({ draftClassId: classId });
    },
    setDraftPreset(presetId) {
      const state = runtime.read();
      const preset = presetId ? PROFILE_PRESETS[presetId] : undefined;
      const nextPresetId = preset ? presetId : null;
      const classId = preset?.classId ?? state.draftClassId;
      runtime.updateTransient({ draftPresetId: nextPresetId, draftClassId: classId });
    },
    setDraftServiceEnabled(enabled) {
      runtime.updateTransient({ draftServiceEnabled: enabled });
    },
    setDraftOneWay(on) {
      runtime.updateTransient({ draftOneWay: on });
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
      runtime.updateTransient({ draftFacilityTypeId: typeId, draftFacilityComplexMode: false });
    },
    setDraftFacilityComplexMode(on) {
      runtime.updateTransient({ draftFacilityComplexMode: on });
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
  options: ToolCommandOptions = {},
): ToolCommands {
  return {
    ...createToolSelectionCommands(runtime, options.createId ?? shortId),
    ...createWayDraftCommands(runtime),
    ...createFacilityDraftCommands(runtime),
  };
}
