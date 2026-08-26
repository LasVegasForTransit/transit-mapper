import { describe, expect, it } from 'vitest';
import {
  parseCreateViewRequest,
  parseUpdateViewRequest,
  serializeCreateViewRequest,
} from '../src/api-contract';

const networkState = {
  schemaVersion: 1 as const,
  camera: { center: [-115.17, 36.14] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: { modes: ['bus'], landmarks: true },
};

describe('published View API contract', () => {
  it('parses the fields that create one published View', () => {
    expect(
      parseCreateViewRequest({
        title: 'Downtown buses',
        description: 'Frequent service around downtown.',
        sharedSystemId: 'shared-system-1',
        state: networkState,
      }),
    ).toEqual({
      title: 'Downtown buses',
      description: 'Frequent service around downtown.',
      sharedSystemId: 'shared-system-1',
      state: {
        schemaVersion: 1,
        camera: { center: [-115.17, 36.14], zoom: 11 },
        representationId: 'network',
        filters: { modes: ['bus'], landmarks: true },
      },
    });
  });

  it('rejects local document selections at the publication boundary', () => {
    expect(() =>
      parseCreateViewRequest({
        title: 'Private selection',
        sharedSystemId: 'shared-system-1',
        state: {
          ...networkState,
          selection: { source: 'local-document', kind: 'stop', id: 'stop-1' },
        },
      }),
    ).toThrow('selection.source cannot be local-document');
  });

  it('accepts partial mutable fields without accepting immutable references', () => {
    expect(parseUpdateViewRequest({ description: null, state: networkState })).toEqual({
      description: null,
      state: {
        schemaVersion: 1,
        camera: { center: [-115.17, 36.14], zoom: 11 },
        representationId: 'network',
        filters: { modes: ['bus'], landmarks: true },
      },
    });
    expect(() => parseUpdateViewRequest({ sharedSystemId: 'replacement' })).toThrow(
      'View update contains an immutable field',
    );
  });

  it('measures the exact UTF-8 request body sent to the Worker', () => {
    const serialized = serializeCreateViewRequest({
      title: 'Buses 🚍',
      sharedSystemId: 'shared-system-1',
      state: networkState,
    });

    expect(serialized.body).toBe(
      '{"title":"Buses 🚍","sharedSystemId":"shared-system-1","state":{"schemaVersion":1,"camera":{"center":[-115.17,36.14],"zoom":11},"representationId":"network","filters":{"modes":["bus"],"landmarks":true}}}',
    );
    expect(serialized.byteLength).toBe(new TextEncoder().encode(serialized.body).byteLength);
  });

  it('refuses a valid View whose request envelope exceeds 32 KiB', () => {
    const filters = Object.fromEntries(
      Array.from({ length: 32 }, (_, filterIndex) => [
        `filter-${filterIndex}`,
        Array.from({ length: 64 }, () => 'x'.repeat(64)),
      ]),
    );

    expect(() =>
      serializeCreateViewRequest({
        title: 'Oversized filters',
        sharedSystemId: 'shared-system-1',
        state: { ...networkState, filters },
      }),
    ).toThrow('View request body may contain at most 32 KiB');
  });
});
