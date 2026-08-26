import { describe, expect, it } from 'vitest';
import type { MapDefinition } from '../src/map-driver';
import { resolveMapPresentationState } from '../src/map-definition-state';

const DEFINITION: MapDefinition = {
  id: 'document',
  title: 'Transit system',
  representations: [
    { id: 'network', label: 'Network' },
    { id: 'infrastructure', label: 'Infrastructure' },
  ],
  filters: [
    {
      kind: 'multi-select',
      id: 'modes',
      label: 'Services',
      options: [
        { id: 'bus', label: 'Bus' },
        { id: 'rail', label: 'Rail' },
      ],
      defaultValue: ['bus', 'rail'],
    },
    { kind: 'toggle', id: 'landmarks', label: 'Landmarks', defaultValue: true },
  ],
  attribution: [],
};

describe('map definition presentation state', () => {
  it('falls back from unknown representations and invalid filter values', () => {
    expect(
      resolveMapPresentationState(DEFINITION, {
        schemaVersion: 1,
        camera: { center: [-115, 36], zoom: 11 },
        representationId: 'unknown',
        filters: {
          modes: ['rail', 'unknown'],
          landmarks: 'wrong-kind',
          unexpected: true,
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      camera: { center: [-115, 36], zoom: 11 },
      representationId: 'network',
      filters: { modes: ['rail'], landmarks: true },
    });
  });

  it('uses definition defaults when the incoming state omits filters', () => {
    expect(
      resolveMapPresentationState(DEFINITION, {
        schemaVersion: 1,
        camera: { center: [0, 0], zoom: 2 },
        representationId: 'infrastructure',
        filters: {},
      }).filters,
    ).toEqual({ modes: ['bus', 'rail'], landmarks: true });
  });
});
