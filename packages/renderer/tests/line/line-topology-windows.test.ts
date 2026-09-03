import { describe, expect, it } from 'vitest';
import { transitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { ResolvedNetworkChunk } from '@transitmapper/core/network/resolved-network-chunk';
import { preparePatternLegIndex } from '../../src/line/pattern-leg-index';
import { prepareLineSpanInput } from '../../src/line/line-spans';
import { prepareTopologyWindow } from '../../src/line/line-topology-windows';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';

function aTopologyChunk(): ResolvedNetworkChunk {
  const source = aLineSpanChunk();
  const firstCarrier = aResolvedCarrier({
    id: 'carrier-first',
    alignmentRange: [0, 0.5],
    points: [
      [0, 0],
      [0.5, 0],
    ],
  });
  const secondCarrier = aResolvedCarrier({
    id: 'carrier-second',
    alignmentRange: [0.5, 1],
    points: [
      [0.5, 0],
      [1, 0],
    ],
  });
  const firstFragment = aResolvedPatternLeg({
    id: 'fragment-first',
    logicalPatternLegFragmentId: 'logical-first',
    legIndex: 1,
    carrierFragmentId: firstCarrier.id,
    carrierRange: [0, 0.5],
    logicalCarrierRange: [0, 0.5],
    logicalAlignmentRange: [0, 0.5],
  });
  const secondFragment = aResolvedPatternLeg({
    id: 'fragment-second',
    logicalPatternLegFragmentId: 'logical-second',
    legIndex: 1,
    carrierFragmentId: secondCarrier.id,
    carrierRange: [0.5, 1],
    logicalCarrierRange: [0.5, 1],
    logicalAlignmentRange: [0.5, 1],
  });

  return {
    ...source,
    entities: {
      ...source.entities,
      stops: [
        {
          id: 'stop-before',
          location: { kind: 'known', value: [0, 0] },
          stationId: 'station',
          major: false,
        },
        {
          id: 'stop-after',
          location: { kind: 'known', value: [1, 0] },
          stationId: 'station',
          major: false,
        },
      ],
      stations: [{ id: 'station', location: { kind: 'known', value: [0.5, 0] } }],
    },
    relationships: {
      ...source.relationships,
      patternStopCalls: [
        {
          id: 'call-before',
          patternId: 'pattern',
          stopId: 'stop-before',
          sequence: 0,
          service: 'served',
          pathAnchor: { legIndex: 0, carrierPosition: 1 },
        },
        {
          id: 'call-after',
          patternId: 'pattern',
          stopId: 'stop-after',
          sequence: 1,
          service: 'served',
          pathAnchor: { legIndex: 2, carrierPosition: 0 },
        },
      ],
      topologyWindows: [
        {
          id: 'window',
          patternId: 'pattern',
          anchoredCalls: [
            { stopCallId: 'call-before', patternLegBoundaryIndex: 0 },
            { stopCallId: 'call-after', patternLegBoundaryIndex: 2 },
          ],
          patternLegFragmentIds: [firstFragment.id, secondFragment.id],
        },
      ],
    },
    geometry: {
      carriers: [firstCarrier, secondCarrier],
      patternLegs: [firstFragment, secondFragment],
      visiblePatternLegFragmentIds: [firstFragment.id],
    },
  };
}

function preparedPatternLegIndex(projection: ReturnType<typeof aLineSpanProjection>) {
  const input = prepareLineSpanInput(projection.result.chunks);
  expect(input.kind).toBe('ready');
  if (input.kind !== 'ready') throw new Error('Expected prepared Pattern-leg input.');
  const result = preparePatternLegIndex(projection, input.input);
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('Expected a prepared Pattern-leg index.');
  return result.index;
}

function topologyWindow(projection: ReturnType<typeof aLineSpanProjection>) {
  return prepareTopologyWindow(projection, preparedPatternLegIndex(projection), 'window');
}

describe('topology windows', () => {
  it('resolves canonical topology evidence without inferring a call boundary from its anchor', () => {
    const projection = aLineSpanProjection({ chunks: [aTopologyChunk()] });
    const result = topologyWindow(projection);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected a prepared topology window.');
    expect(result.window.anchoredCalls).toEqual([
      {
        stopCallId: 'call-before',
        sequence: 0,
        patternLegBoundaryIndex: 0,
        pathAnchor: { legIndex: 0, carrierPosition: 1 },
        stopKey: transitEntityKey({ kind: 'stop', id: 'stop-before' }),
        stationKey: transitEntityKey({ kind: 'station', id: 'station' }),
      },
      {
        stopCallId: 'call-after',
        sequence: 1,
        patternLegBoundaryIndex: 2,
        pathAnchor: { legIndex: 2, carrierPosition: 0 },
        stopKey: transitEntityKey({ kind: 'stop', id: 'stop-after' }),
        stationKey: transitEntityKey({ kind: 'station', id: 'station' }),
      },
    ]);
    expect(
      result.window.fragments.map(({ fragmentId, patternLeg }) => ({
        fragmentId,
        logicalPatternLegId: patternLeg.logical.id,
        legIndex: patternLeg.logical.legIndex,
      })),
    ).toEqual([
      { fragmentId: 'fragment-first', logicalPatternLegId: 'logical-first', legIndex: 1 },
      { fragmentId: 'fragment-second', logicalPatternLegId: 'logical-second', legIndex: 1 },
    ]);
    expect(result.window.fragments[0].shard.carrier.points).toBe(
      projection.index.carrierFragmentsById.get('carrier-first')?.points,
    );
  });

  it('retains several calls at the same explicit topology boundary', () => {
    const source = aTopologyChunk();
    const before = source.relationships.patternStopCalls[0];
    const after = source.relationships.patternStopCalls[1];
    const window = source.relationships.topologyWindows[0];
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...source,
          entities: {
            ...source.entities,
            stops: [
              ...source.entities.stops,
              {
                id: 'stop-before-b',
                location: { kind: 'known', value: [0, 0] },
                stationId: 'station',
                major: false,
              },
            ],
          },
          relationships: {
            ...source.relationships,
            patternStopCalls: [
              before,
              {
                ...before,
                id: 'call-before-b',
                stopId: 'stop-before-b',
                sequence: 1,
              },
              { ...after, sequence: 2 },
            ],
            topologyWindows: [
              {
                ...window,
                anchoredCalls: [
                  { stopCallId: before.id, patternLegBoundaryIndex: 0 },
                  { stopCallId: 'call-before-b', patternLegBoundaryIndex: 0 },
                  { stopCallId: after.id, patternLegBoundaryIndex: 2 },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = topologyWindow(projection);

    expect(result).toMatchObject({ kind: 'ready' });
    if (result.kind !== 'ready') throw new Error('Expected a prepared topology window.');
    expect(
      result.window.anchoredCalls.map(({ patternLegBoundaryIndex }) => patternLegBoundaryIndex),
    ).toEqual([0, 0, 2]);
  });

  it('keeps a Pattern-leg index bound to the exact resolved result', () => {
    const indexedProjection = aLineSpanProjection({ chunks: [aTopologyChunk()] });
    const currentProjection = aLineSpanProjection({ chunks: [aTopologyChunk()] });

    expect(
      prepareTopologyWindow(
        currentProjection,
        preparedPatternLegIndex(indexedProjection),
        'window',
      ),
    ).toEqual({
      kind: 'rejected',
      reason: 'pattern-leg-index-source-mismatch',
      recordId: 'window',
    });
  });

  it('preserves reverse same-leg fragments in supplied travel order', () => {
    const source = aTopologyChunk();
    const window = source.relationships.topologyWindows[0];
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...source,
          relationships: {
            ...source.relationships,
            topologyWindows: [
              {
                ...window,
                patternLegFragmentIds: ['fragment-second', 'fragment-first'] as const,
              },
            ],
          },
          geometry: {
            ...source.geometry,
            patternLegs: source.geometry.patternLegs.map((fragment) => ({
              ...fragment,
              direction: 'reverse',
            })),
          },
        },
      ],
    });

    expect(topologyWindow(projection)).toMatchObject({ kind: 'ready' });
  });

  it('rejects a topology window whose first call is not at its first boundary', () => {
    const source = aTopologyChunk();
    const window = source.relationships.topologyWindows[0];
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...source,
          relationships: {
            ...source.relationships,
            topologyWindows: [
              {
                ...window,
                anchoredCalls: [
                  { stopCallId: 'call-before', patternLegBoundaryIndex: 1 },
                  { stopCallId: 'call-after', patternLegBoundaryIndex: 2 },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(topologyWindow(projection)).toEqual({
      kind: 'rejected',
      reason: 'invalid-topology-boundary',
      recordId: 'call-before',
    });
  });

  it('defers a missing listed fragment only while another page can supply it', () => {
    const source = aTopologyChunk();
    const window = source.relationships.topologyWindows[0];
    const partial = {
      ...source,
      relationships: {
        ...source.relationships,
        topologyWindows: [
          {
            ...window,
            patternLegFragmentIds: ['fragment-first', 'later-fragment'] as const,
          },
        ],
      },
    };

    expect(topologyWindow(aLineSpanProjection({ chunks: [partial] }))).toEqual({
      kind: 'rejected',
      reason: 'missing-topology-fragment',
      recordId: 'later-fragment',
    });
    expect(
      topologyWindow(aLineSpanProjection({ chunks: [partial], nextCursor: 'page-two' })),
    ).toEqual({ kind: 'pending', reason: 'more-pages' });
  });

  it('rejects a topology window that leaves a gap inside one logical Pattern leg', () => {
    const source = aTopologyChunk();
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...source,
          geometry: {
            ...source.geometry,
            carriers: source.geometry.carriers.map((carrier) =>
              carrier.id === 'carrier-second' ? { ...carrier, alignmentRange: [0.6, 1] } : carrier,
            ),
            patternLegs: source.geometry.patternLegs.map((fragment) =>
              fragment.id === 'fragment-first'
                ? {
                    ...fragment,
                    logicalPatternLegFragmentId: 'logical-whole',
                    logicalCarrierRange: [0, 1],
                    logicalAlignmentRange: [0, 1],
                  }
                : {
                    ...fragment,
                    logicalPatternLegFragmentId: 'logical-whole',
                    carrierRange: [0.6, 1],
                    logicalCarrierRange: [0, 1],
                    logicalAlignmentRange: [0, 1],
                  },
            ),
          },
        },
      ],
    });

    expect(topologyWindow(projection)).toEqual({
      kind: 'rejected',
      reason: 'topology-fragment-discontinuity',
      recordId: 'fragment-second',
    });
  });

  it('rejects a topology call that has no supplied path anchor', () => {
    const source = aTopologyChunk();
    const projection = aLineSpanProjection({
      chunks: [
        {
          ...source,
          relationships: {
            ...source.relationships,
            patternStopCalls: source.relationships.patternStopCalls.map((call) =>
              call.id === 'call-before' ? { ...call, pathAnchor: undefined } : call,
            ),
          },
        },
      ],
    });

    expect(topologyWindow(projection)).toEqual({
      kind: 'rejected',
      reason: 'missing-topology-call-anchor',
      recordId: 'call-before',
    });
  });
});
