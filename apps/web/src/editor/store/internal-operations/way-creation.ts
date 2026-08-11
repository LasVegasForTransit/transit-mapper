import {
  PROFILE_PRESETS,
  WAY_TYPES,
  modesForWayType,
  wayType,
} from '@transitmapper/core/model/catalog';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { buildProfile, cloneProfile, makeOneWay } from '@transitmapper/core/model/profile';
import type {
  Line,
  LineGeometry,
  Service,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import { continueNamedWay } from '@transitmapper/core/model/way-property-edits';
import { joinWayPointToWay } from '@transitmapper/core/model/way-point-edits';
import type { EditorState } from '../state';
import {
  DEFAULT_FREQUENCY_MINUTES,
  DEFAULT_SPAN_END,
  DEFAULT_SPAN_START,
  nextDefaultLineName,
} from './service-creation';

interface WayCreationOptions {
  readonly typeId?: string;
  readonly geometry?: LineGeometry;
  readonly color?: string;
}

interface WayCreationChange {
  system: TransitSystem;
  transient: Pick<EditorState, 'activeWayId' | 'selection'>;
  wayId: string;
}

interface WayBranchChange {
  system: TransitSystem;
  transient: Pick<EditorState, 'activeWayId' | 'selection' | 'draftOneWay'>;
  wayId: string;
}

function draftProfile(state: EditorState, typeId: string) {
  const type = wayType(typeId);
  const classId = typeId === state.draftWayTypeId ? state.draftClassId : type.defaultClassId;
  const preset = state.draftPresetId ? PROFILE_PRESETS[state.draftPresetId] : undefined;
  if (preset?.wayTypeId === typeId) {
    return {
      profile: buildProfile(preset.lanes),
      classId: preset.classId ?? classId,
    };
  }
  return {
    profile: buildProfile(type.defaultProfile),
    classId,
  };
}

function compatibleModeId(state: EditorState, typeId: string): string | undefined {
  const compatible = modesForWayType(typeId);
  return compatible.some((mode) => mode.id === state.draftModeId)
    ? state.draftModeId
    : compatible[0]?.id;
}

interface DefaultLineInput {
  state: EditorState;
  wayId: string;
  modeId: string | undefined;
  color: string | undefined;
  createId: () => string;
}

interface DefaultLineResult {
  line: Line;
  service: Service;
}

function defaultLine({
  state,
  wayId,
  modeId,
  color,
  createId,
}: DefaultLineInput): DefaultLineResult | null {
  if (!modeId || state.addingServiceDraft || !state.draftServiceEnabled) return null;
  const serviceId = createId();
  const service: Service = {
    id: serviceId,
    modeId,
    path: { id: serviceId, sections: oneSection([wholeLeg(wayId)]) },
    frequencyMinutes: DEFAULT_FREQUENCY_MINUTES,
    spanStart: DEFAULT_SPAN_START,
    spanEnd: DEFAULT_SPAN_END,
  };
  return {
    service,
    line: {
      id: createId(),
      name: nextDefaultLineName(state.system),
      color: color ?? state.draftColor,
      serviceIds: [serviceId],
    },
  };
}

/** Builds a draft way and optional default service without mutating editor state. */
export function createDraftWay(
  state: EditorState,
  options: WayCreationOptions,
  createId: () => string,
): WayCreationChange | null {
  const typeId = options.typeId ?? state.draftWayTypeId;
  if (!Object.hasOwn(WAY_TYPES, typeId)) return null;
  const draft = draftProfile(state, typeId);
  const wayId = createId();
  const way: Way = {
    id: wayId,
    typeId,
    points: [],
    geometry: options.geometry ?? state.draftGeometry,
    grade: state.draftGrade,
    profile: state.draftOneWay ? makeOneWay(draft.profile, 'forward') : draft.profile,
    classId: draft.classId,
  };
  const addingService = state.addingServiceDraft !== null;
  const created = defaultLine({
    state,
    wayId,
    modeId: compatibleModeId(state, typeId),
    color: options.color,
    createId,
  });
  return {
    system: {
      ...state.system,
      ways: [...state.system.ways, way],
      lines: created ? [...state.system.lines, created.line] : state.system.lines,
      services: created ? [...state.system.services, created.service] : state.system.services,
    },
    transient: {
      activeWayId: wayId,
      selection: created
        ? { kind: 'line', id: created.line.id }
        : addingService
          ? state.selection
          : { kind: 'way', id: wayId },
    },
    wayId,
  };
}

/** Starts a one-way branch from an existing endpoint and continues its identity. */
export function createOneWayBranch(
  state: EditorState,
  fromWayId: string,
  end: 'start' | 'end',
  createId: () => string,
): WayBranchChange | null {
  const source = state.system.ways.find((way) => way.id === fromWayId);
  if (!source || source.points.length < 2) return null;
  const branchPoint = end === 'start' ? source.points[0] : source.points[source.points.length - 1];
  const wayId = createId();
  const way: Way = {
    id: wayId,
    typeId: source.typeId,
    points: [branchPoint],
    geometry: state.draftGeometry,
    grade: source.grade,
    profile: makeOneWay(cloneProfile(source.profile), 'forward'),
    classId: source.classId,
  };
  let system: TransitSystem = {
    ...state.system,
    ways: [...state.system.ways, way],
  };
  system = joinWayPointToWay(
    system,
    { wayId, index: 0, targetWayId: fromWayId, coord: branchPoint },
    createId,
  );
  system = continueNamedWay(system, fromWayId, wayId);
  return {
    system,
    transient: {
      activeWayId: wayId,
      selection: { kind: 'way', id: wayId },
      draftOneWay: true,
    },
    wayId,
  };
}
