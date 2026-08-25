import { describe, expect, it } from 'vitest';
import {
  MAX_NAMED_VIEW_JSON_BYTES,
  parseMapViewState,
  parseMapViewStateJson,
  parseSavedView,
} from '../src/index';

const VALID_STATE = {
  schemaVersion: 1,
  camera: { center: [-115.1728, 36.1147], zoom: 11 },
  representationId: 'network',
  filters: {
    landmarks: true,
    modes: ['bus', 'rail'],
    emphasis: 'frequent',
  },
  selection: { source: 'document', kind: 'station', id: 'station-1' },
} as const;

describe('parseMapViewState', () => {
  it('returns only portable View state from a valid value', () => {
    expect(parseMapViewState({ ...VALID_STATE, ignored: 'not portable' })).toEqual(VALID_STATE);
  });

  it.each([
    ['longitude', { ...VALID_STATE, camera: { center: [-181, 36], zoom: 11 } }],
    ['latitude', { ...VALID_STATE, camera: { center: [-115, 91], zoom: 11 } }],
    ['zoom', { ...VALID_STATE, camera: { center: [-115, 36], zoom: 25 } }],
  ])('rejects a camera with an invalid %s', (_name, value) => {
    expect(() => parseMapViewState(value)).toThrow('camera');
  });

  it('rejects more than 32 filters', () => {
    const filters = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`filter-${index}`, true]),
    );

    expect(() => parseMapViewState({ ...VALID_STATE, filters })).toThrow('32');
  });

  it('rejects more than 64 values in a multi-select filter', () => {
    const filters = { modes: Array.from({ length: 65 }, (_, index) => `mode-${index}`) };

    expect(() => parseMapViewState({ ...VALID_STATE, filters })).toThrow('64');
  });

  it('measures bounded strings in UTF-8 bytes', () => {
    const sixtyFiveBytes = `${'a'.repeat(63)}é`;

    expect(() => parseMapViewState({ ...VALID_STATE, representationId: sixtyFiveBytes })).toThrow(
      '64 UTF-8 bytes',
    );
  });

  it('allows a 256-byte feature id and rejects a longer one', () => {
    expect(
      parseMapViewState({
        ...VALID_STATE,
        selection: { ...VALID_STATE.selection, id: 'x'.repeat(256) },
      }).selection?.id,
    ).toHaveLength(256);

    expect(() =>
      parseMapViewState({
        ...VALID_STATE,
        selection: { ...VALID_STATE.selection, id: 'x'.repeat(257) },
      }),
    ).toThrow('256 UTF-8 bytes');
  });

  it('rejects a named View JSON body before parsing more than 32 KiB', () => {
    const oversized = ' '.repeat(MAX_NAMED_VIEW_JSON_BYTES + 1);

    expect(() => parseMapViewStateJson(oversized)).toThrow('32 KiB');
  });
});

describe('parseSavedView', () => {
  it('parses a saved View over a shared system', () => {
    const view = {
      schemaVersion: 1,
      id: 'view-1',
      title: 'Downtown frequent transit',
      description: 'Frequent routes and rail stations.',
      map: { kind: 'shared-system', id: 'share-1' },
      state: VALID_STATE,
    } as const;

    expect(parseSavedView(view)).toEqual(view);
  });

  it('rejects a local document reference at the portable boundary', () => {
    expect(() =>
      parseSavedView({
        schemaVersion: 1,
        id: 'view-1',
        title: 'Local map',
        map: { kind: 'local-document', id: 'document-1' },
        state: VALID_STATE,
      }),
    ).toThrow('shared-system');
  });
});
