import {
  MAP_VIEW_SCHEMA_VERSION,
  type MapCameraStateV1,
  type MapFeatureReferenceV1,
  type MapFilterValue,
  type MapViewStateV1,
  type SavedViewV1,
  type SharedSystemMapReferenceV1,
} from './contract';

export const MAX_NAMED_VIEW_JSON_BYTES = 32 * 1024;
export const MAX_VIEW_FILTERS = 32;
export const MAX_MULTI_SELECT_VALUES = 64;

const MAX_FILTER_STRING_BYTES = 64;
const MAX_FEATURE_ID_BYTES = 256;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export class ViewParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewParseError';
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewParseError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, path: string, maxBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new ViewParseError(`${path} must be a non-empty string`);
  }
  if (utf8ByteLength(value) > maxBytes) {
    throw new ViewParseError(`${path} must contain at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function boundedText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ViewParseError(`${path} must contain between 1 and ${maxLength} characters`);
  }
  return value;
}

function parseCamera(value: unknown): MapCameraStateV1 {
  const camera = recordAt(value, 'camera');
  const center = camera.center;
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    typeof center[0] !== 'number' ||
    !Number.isFinite(center[0]) ||
    center[0] < -180 ||
    center[0] > 180 ||
    typeof center[1] !== 'number' ||
    !Number.isFinite(center[1]) ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    throw new ViewParseError('camera.center must contain valid longitude and latitude');
  }
  if (
    typeof camera.zoom !== 'number' ||
    !Number.isFinite(camera.zoom) ||
    camera.zoom < 0 ||
    camera.zoom > 24
  ) {
    throw new ViewParseError('camera.zoom must be between 0 and 24');
  }
  return { center: [center[0], center[1]], zoom: camera.zoom };
}

function parseFilterValue(value: unknown, path: string): MapFilterValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return boundedString(value, path, MAX_FILTER_STRING_BYTES, true);
  }
  if (!Array.isArray(value)) {
    throw new ViewParseError(`${path} must be a boolean, string, or string array`);
  }
  if (value.length > MAX_MULTI_SELECT_VALUES) {
    throw new ViewParseError(`${path} may contain at most ${MAX_MULTI_SELECT_VALUES} values`);
  }
  return value.map((item, index) =>
    boundedString(item, `${path}[${index}]`, MAX_FILTER_STRING_BYTES, true),
  );
}

function parseFilters(value: unknown): Record<string, MapFilterValue> {
  const input = recordAt(value, 'filters');
  const entries = Object.entries(input);
  if (entries.length > MAX_VIEW_FILTERS) {
    throw new ViewParseError(`filters may contain at most ${MAX_VIEW_FILTERS} entries`);
  }
  return Object.fromEntries(
    entries.map(([id, filterValue]) => [
      boundedString(id, 'filter id', MAX_FILTER_STRING_BYTES),
      parseFilterValue(filterValue, `filters.${id}`),
    ]),
  );
}

function parseSelection(value: unknown): MapFeatureReferenceV1 {
  const selection = recordAt(value, 'selection');
  return {
    source: boundedString(selection.source, 'selection.source', MAX_FILTER_STRING_BYTES),
    kind: boundedString(selection.kind, 'selection.kind', MAX_FILTER_STRING_BYTES),
    id: boundedString(selection.id, 'selection.id', MAX_FEATURE_ID_BYTES),
  };
}

export function parseMapViewState(value: unknown): MapViewStateV1 {
  const state = recordAt(value, 'View state');
  if (state.schemaVersion !== MAP_VIEW_SCHEMA_VERSION) {
    throw new ViewParseError(`schemaVersion must be ${MAP_VIEW_SCHEMA_VERSION}`);
  }
  const parsed: MapViewStateV1 = {
    schemaVersion: MAP_VIEW_SCHEMA_VERSION,
    camera: parseCamera(state.camera),
    representationId: boundedString(
      state.representationId,
      'representationId',
      MAX_FILTER_STRING_BYTES,
    ),
    filters: parseFilters(state.filters),
  };
  if (state.selection !== undefined) parsed.selection = parseSelection(state.selection);
  return parsed;
}

export function parseMapViewStateJson(json: string): MapViewStateV1 {
  if (utf8ByteLength(json) > MAX_NAMED_VIEW_JSON_BYTES) {
    throw new ViewParseError('Named View JSON may contain at most 32 KiB');
  }
  try {
    return parseMapViewState(JSON.parse(json));
  } catch (error) {
    if (error instanceof ViewParseError) throw error;
    throw new ViewParseError('Named View JSON must contain valid JSON');
  }
}

function parseMapReference(value: unknown): SharedSystemMapReferenceV1 {
  const map = recordAt(value, 'map');
  if (map.kind !== 'shared-system') {
    throw new ViewParseError('map.kind must be shared-system');
  }
  return {
    kind: 'shared-system',
    id: boundedString(map.id, 'map.id', MAX_FEATURE_ID_BYTES),
  };
}

export function parseSavedView(value: unknown): SavedViewV1 {
  const view = recordAt(value, 'Saved View');
  if (view.schemaVersion !== MAP_VIEW_SCHEMA_VERSION) {
    throw new ViewParseError(`schemaVersion must be ${MAP_VIEW_SCHEMA_VERSION}`);
  }
  const parsed: SavedViewV1 = {
    schemaVersion: MAP_VIEW_SCHEMA_VERSION,
    id: boundedString(view.id, 'id', MAX_FEATURE_ID_BYTES),
    title: boundedText(view.title, 'title', MAX_TITLE_LENGTH),
    map: parseMapReference(view.map),
    state: parseMapViewState(view.state),
  };
  if (view.description !== undefined) {
    parsed.description = boundedText(view.description, 'description', MAX_DESCRIPTION_LENGTH);
  }
  return parsed;
}

export function parseSavedViewJson(json: string): SavedViewV1 {
  if (utf8ByteLength(json) > MAX_NAMED_VIEW_JSON_BYTES) {
    throw new ViewParseError('Named View JSON may contain at most 32 KiB');
  }
  try {
    return parseSavedView(JSON.parse(json));
  } catch (error) {
    if (error instanceof ViewParseError) throw error;
    throw new ViewParseError('Named View JSON must contain valid JSON');
  }
}
