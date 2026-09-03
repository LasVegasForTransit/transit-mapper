import { describe, expect, it } from 'vitest';
import { deriveWindows } from '../../src/network/schema-v16-system/topology';
import type {
  DerivedCall,
  DerivedLegFragment,
  DerivedPattern,
} from '../../src/network/schema-v16-system/patterns';
import { aRoad, aService } from '../support/fixtures.test';

function aCall(id: string, sequence: number, pathOrder: number): DerivedCall {
  return {
    id,
    patternId: 'pattern',
    stopId: `${id}-stop`,
    sequence,
    service: 'served',
    pathAnchor: { legIndex: pathOrder === 1 ? 0 : 1, carrierPosition: 1 },
    pathOrder,
  };
}

describe('schema-v16 topology windows', () => {
  it('places a bounding call at the fragment boundary without inferring its anchored leg', () => {
    const way = aRoad('next-leg', [
      [0, 0],
      [1, 0],
    ]);
    const service = aService('service', []);
    const start: DerivedCall = {
      id: 'boundary-call',
      patternId: 'pattern',
      stopId: 'boundary-stop',
      sequence: 0,
      service: 'served',
      pathAnchor: { legIndex: 0, carrierPosition: 1 },
      pathOrder: 1,
    };
    const end: DerivedCall = {
      id: 'next-call',
      patternId: 'pattern',
      stopId: 'next-stop',
      sequence: 1,
      service: 'served',
      pathAnchor: { legIndex: 1, carrierPosition: 1 },
      pathOrder: 2,
    };
    const fragment: DerivedLegFragment = {
      id: 'next-leg-fragment',
      patternId: 'pattern',
      legIndex: 1,
      carrierRange: [0, 1],
      direction: 'forward',
      pathOrderStart: 1,
      pathOrderEnd: 2,
      way,
    };
    const pattern: DerivedPattern = {
      patternId: 'pattern',
      service,
      run: 'outbound',
      path: 'known',
      calls: [start, end],
      fragments: [fragment],
    };

    expect(deriveWindows(pattern, new Set([fragment.id]))[0]?.window).toMatchObject({
      anchoredCalls: [
        { stopCallId: start.id, patternLegBoundaryIndex: 0 },
        { stopCallId: end.id, patternLegBoundaryIndex: 1 },
      ],
      patternLegFragmentIds: [fragment.id],
    });
  });

  it('keeps every call that shares a topology boundary', () => {
    const way = aRoad('shared-leg', [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const calls = [
      aCall('start-a', 0, 1),
      aCall('start-b', 1, 1),
      aCall('end-a', 2, 2),
      aCall('end-b', 3, 2),
    ];
    const fragments: DerivedLegFragment[] = [
      {
        id: 'first-fragment',
        patternId: 'pattern',
        legIndex: 1,
        carrierRange: [0, 0.5],
        direction: 'forward',
        pathOrderStart: 1,
        pathOrderEnd: 1.5,
        way,
      },
      {
        id: 'second-fragment',
        patternId: 'pattern',
        legIndex: 1,
        carrierRange: [0.5, 1],
        direction: 'forward',
        pathOrderStart: 1.5,
        pathOrderEnd: 2,
        way,
      },
    ];
    const pattern: DerivedPattern = {
      patternId: 'pattern',
      service: aService('service', []),
      run: 'outbound',
      path: 'known',
      calls,
      fragments,
    };

    const [derivedWindow] = deriveWindows(pattern, new Set([fragments[0].id]));

    expect(derivedWindow.window).toMatchObject({
      patternId: 'pattern',
      anchoredCalls: [
        { stopCallId: 'start-a', patternLegBoundaryIndex: 0 },
        { stopCallId: 'start-b', patternLegBoundaryIndex: 0 },
        { stopCallId: 'end-a', patternLegBoundaryIndex: 2 },
        { stopCallId: 'end-b', patternLegBoundaryIndex: 2 },
      ],
      patternLegFragmentIds: ['first-fragment', 'second-fragment'],
    });
    expect(derivedWindow.calls).toEqual(calls);
    expect(derivedWindow.fragments).toEqual(fragments);
  });
});
