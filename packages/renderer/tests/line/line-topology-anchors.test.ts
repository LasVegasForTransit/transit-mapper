import { describe, expect, it } from 'vitest';
import { transitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import {
  enumerateTopologyAnchorMatches,
  matchTopologyAnchor,
} from '../../src/line/line-topology-anchors';
import type { PreparedTopologyWindowCall } from '../../src/line/line-topology-window-types';

interface TopologyAnchorCallOptions {
  readonly stopId: string;
  readonly stationId?: string;
}

function aTopologyAnchorCall({
  stopId,
  stationId,
}: TopologyAnchorCallOptions): PreparedTopologyWindowCall {
  return {
    stopCallId: `call-${stopId}`,
    sequence: 0,
    patternLegBoundaryIndex: 0,
    pathAnchor: { legIndex: 0, carrierPosition: 0 },
    stopKey: transitEntityKey({ kind: 'stop', id: stopId }),
    ...(stationId === undefined
      ? {}
      : { stationKey: transitEntityKey({ kind: 'station', id: stationId }) }),
  };
}

describe('topology anchor matching', () => {
  it('prefers an exact Stop match over parent Station identity', () => {
    const stop = aTopologyAnchorCall({ stopId: 'stop', stationId: 'station-a' });
    const sameStop = aTopologyAnchorCall({ stopId: 'stop', stationId: 'station-b' });

    expect(matchTopologyAnchor(stop, sameStop)).toEqual({
      kind: 'stop',
      anchorKey: transitEntityKey({ kind: 'stop', id: 'stop' }),
    });
  });

  it('matches distinct Stops only through an explicit shared parent Station', () => {
    const left = aTopologyAnchorCall({ stopId: 'platform-north', stationId: 'station' });
    const right = aTopologyAnchorCall({ stopId: 'platform-south', stationId: 'station' });

    expect(matchTopologyAnchor(left, right)).toEqual({
      kind: 'station',
      anchorKey: transitEntityKey({ kind: 'station', id: 'station' }),
    });
  });

  it('does not manufacture an anchor match from unrelated Stops', () => {
    const left = aTopologyAnchorCall({ stopId: 'left' });
    const right = aTopologyAnchorCall({ stopId: 'right' });

    expect(matchTopologyAnchor(left, right)).toBeUndefined();
  });

  it('retains every repeated authored anchor occurrence for later correspondence', () => {
    const left = [
      aTopologyAnchorCall({ stopId: 'left-a', stationId: 'station' }),
      aTopologyAnchorCall({ stopId: 'left-b', stationId: 'station' }),
    ];
    const right = [
      aTopologyAnchorCall({ stopId: 'right-a', stationId: 'station' }),
      aTopologyAnchorCall({ stopId: 'right-b', stationId: 'station' }),
    ];

    expect(enumerateTopologyAnchorMatches(left, right)).toEqual([
      {
        leftCallIndex: 0,
        rightCallIndex: 0,
        match: { kind: 'station', anchorKey: transitEntityKey({ kind: 'station', id: 'station' }) },
      },
      {
        leftCallIndex: 0,
        rightCallIndex: 1,
        match: { kind: 'station', anchorKey: transitEntityKey({ kind: 'station', id: 'station' }) },
      },
      {
        leftCallIndex: 1,
        rightCallIndex: 0,
        match: { kind: 'station', anchorKey: transitEntityKey({ kind: 'station', id: 'station' }) },
      },
      {
        leftCallIndex: 1,
        rightCallIndex: 1,
        match: { kind: 'station', anchorKey: transitEntityKey({ kind: 'station', id: 'station' }) },
      },
    ]);
  });
});
