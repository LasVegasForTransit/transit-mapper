import { INITIAL_DRAFT, wayType, type Grade } from '@transitmapper/core/model/catalog';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { LineGeometry, TransitSystem } from '@transitmapper/core/model/system';
import type { PatternPosition } from '@transitmapper/core/model/serviceEdits';
import type { SelectionRef } from '@transitmapper/core/model/selectionActions';
import type { RouteAnchor, RouteSpan } from '@transitmapper/core/model/routeGraph';
import { modeRender } from '@transitmapper/core/style/catalogStyle';

export type Tool = 'select' | 'way' | 'stop' | 'facility' | 'lines' | 'demolish';

export type Selection =
  | { kind: 'way'; id: string; relatedIds?: string[] }
  | { kind: 'line'; id: string }
  | { kind: 'service'; id: string; stopId?: string }
  | { kind: 'stop'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'node'; id: string }
  | null;

/** One object in a group selection. The single selection still drives the inspector. */
export type MultiSelectItem = SelectionRef;

/** What a Select press does. Keyboard modifiers may temporarily override it. */
export type SelectVariant = 'select' | 'erase' | 'split';

export type DocumentStatus = 'loading' | 'ready';

export interface ArmedTerminus {
  serviceId: string;
  patternId: string;
  side: 'start' | 'end';
  position: PatternPosition;
}

interface RouteDraftTarget {
  serviceId: string;
  patternId: string;
}

export interface RouteDraft {
  modeId: string;
  lastAnchor: RouteAnchor;
  spans: RouteSpan[];
  returnFor?: RouteDraftTarget;
}

/** Reactive editor data. Commands deliberately never live in a Zustand snapshot. */
export interface EditorState {
  system: TransitSystem;
  tool: Tool;
  selectVariant: SelectVariant;
  selection: Selection;
  outlineHover: Selection;
  activePatternId: string | null;
  armedTerminus: ArmedTerminus | null;
  cameraFocusToken: number;
  focusNameToken: number;
  focusNameStopId: string | null;
  multiSelection: MultiSelectItem[];
  activeWayId: string | null;
  draftSeparate: boolean;
  draftWayTypeId: string;
  draftModeId: string;
  draftGeometry: LineGeometry;
  draftColor: string;
  draftGrade: Grade;
  draftClassId: string | undefined;
  draftPresetId: string | null;
  draftServiceEnabled: boolean;
  draftOneWay: boolean;
  draftFacilityTypeId: string;
  draftFacilityComplexMode: boolean;
  placingFacilityForGroupId: string | null;
  pickingMemberForGroupId: string | null;
  addingServiceDraft: { lineId: string; name: string; modeId: string } | null;
  readOnly: boolean;
  documentStatus: DocumentStatus;
  canUndo: boolean;
  canRedo: boolean;
  routeDraft: RouteDraft | null;
}

export function createInitialEditorState(documentStatus: DocumentStatus): EditorState {
  return {
    system: createEmptySystem(),
    documentStatus,
    tool: 'select',
    selectVariant: 'select',
    selection: null,
    outlineHover: null,
    activePatternId: null,
    armedTerminus: null,
    cameraFocusToken: 0,
    focusNameToken: 0,
    focusNameStopId: null,
    multiSelection: [],
    activeWayId: null,
    draftSeparate: false,
    draftWayTypeId: INITIAL_DRAFT.wayTypeId,
    draftModeId: INITIAL_DRAFT.modeId,
    draftGeometry: INITIAL_DRAFT.geometry,
    draftColor: modeRender(INITIAL_DRAFT.modeId).color,
    draftGrade: INITIAL_DRAFT.grade,
    draftClassId: wayType(INITIAL_DRAFT.wayTypeId).defaultClassId,
    draftPresetId: null,
    draftServiceEnabled: true,
    routeDraft: null,
    draftOneWay: false,
    draftFacilityTypeId: 'entrance',
    draftFacilityComplexMode: false,
    placingFacilityForGroupId: null,
    pickingMemberForGroupId: null,
    addingServiceDraft: null,
    readOnly: false,
    canUndo: false,
    canRedo: false,
  };
}
