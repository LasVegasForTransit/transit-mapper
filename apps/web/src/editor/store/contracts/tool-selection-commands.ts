import type { Grade } from '@transitmapper/core/model/catalog';
import type { LineGeometry } from '@transitmapper/core/model/system';
import type { ArmedTerminus, MultiSelectItem, Selection, SelectVariant, Tool } from '../state';

export interface ToolCommands {
  readonly setTool: (tool: Tool) => void;
  readonly setSelectVariant: (variant: SelectVariant) => void;
  readonly setDraftWayType: (typeId: string) => void;
  readonly setDraftSeparate: (separate: boolean) => void;
  readonly setDraftMode: (modeId: string) => void;
  readonly setDraftGeometry: (geometry: LineGeometry) => void;
  readonly setDraftColor: (color: string) => void;
  readonly setDraftGrade: (grade: Grade) => void;
  readonly setDraftClassId: (classId: string | undefined) => void;
  readonly setDraftPreset: (presetId: string | null) => void;
  readonly setDraftServiceEnabled: (enabled: boolean) => void;
  readonly setDraftOneWay: (on: boolean) => void;
  readonly setDraftFacilityType: (typeId: string) => void;
  readonly setDraftFacilityComplexMode: (on: boolean) => void;
  readonly addPaletteColor: (color: string) => void;
}

export interface SelectionCommands {
  readonly select: (selection: Selection) => void;
  readonly setOutlineHover: (selection: Selection) => void;
  readonly setActivePattern: (patternId: string | null) => void;
  readonly armTerminus: (terminus: ArmedTerminus) => void;
  readonly clearArmedTerminus: () => void;
  readonly selectAndFocus: (selection: Selection) => void;
  readonly toggleMultiSelect: (item: MultiSelectItem) => void;
  readonly extendSelection: (item: MultiSelectItem) => void;
  readonly addMultiSelection: (items: MultiSelectItem[]) => void;
  readonly clearMultiSelection: () => void;
  readonly deleteMultiSelection: () => void;
  readonly nudgeMultiSelection: (dx: number, dy: number) => void;
}
