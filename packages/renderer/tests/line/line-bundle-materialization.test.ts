import { describe, expect, it } from 'vitest';
import { materializeLineBundles } from '../../src/line';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';
function sharedCarrierProjection() {
  const source = aLineSpanChunk();
  const localCarrier = aResolvedCarrier({
    id: 'local-carrier',
    carrier: { kind: 'alignment', id: 'shared-corridor' },
    alignmentId: 'shared-corridor',
    alignmentRange: [0, 1],
  });
  const expressCarrier = aResolvedCarrier({
    id: 'express-carrier',
    carrier: { kind: 'alignment', id: 'shared-corridor' },
    alignmentId: 'shared-corridor',
    alignmentRange: [0, 1],
  });
  const localLeg = aResolvedPatternLeg({
    id: 'local-leg',
    logicalPatternLegFragmentId: 'local-logical-leg',
    patternId: 'local-pattern',
    carrierFragmentId: localCarrier.id,
    carrierRange: [0, 1],
    logicalCarrierRange: [0, 1],
    logicalAlignmentRange: [0, 1],
  });
  const expressLeg = aResolvedPatternLeg({
    id: 'express-leg',
    logicalPatternLegFragmentId: 'express-logical-leg',
    patternId: 'express-pattern',
    carrierFragmentId: expressCarrier.id,
    carrierRange: [0, 1],
    logicalCarrierRange: [0, 1],
    logicalAlignmentRange: [0, 1],
  });
  return aLineSpanProjection({
    lineOrder: [
      { lineId: 'express', rank: 0 },
      { lineId: 'local', rank: 1 },
    ],
    chunks: [
      {
        ...source,
        entities: {
          ...source.entities,
          lines: [
            { id: 'local', name: 'Local' },
            { id: 'express', name: 'Express' },
          ],
          servicePlans: [
            { id: 'local-plan', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
            { id: 'express-plan', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
          ],
          patterns: [
            { id: 'local-pattern', path: 'known' },
            { id: 'express-pattern', path: 'known' },
          ],
          alignments: [{ id: 'shared-corridor' }],
        },
        relationships: {
          ...source.relationships,
          lineServicePlans: [
            { id: 'local-plan-link', lineId: 'local', servicePlanId: 'local-plan' },
            { id: 'express-plan-link', lineId: 'express', servicePlanId: 'express-plan' },
          ],
          servicePlanPatterns: [
            { id: 'local-pattern-link', servicePlanId: 'local-plan', patternId: 'local-pattern' },
            {
              id: 'express-pattern-link',
              servicePlanId: 'express-plan',
              patternId: 'express-pattern',
            },
          ],
        },
        geometry: {
          carriers: [localCarrier, expressCarrier],
          patternLegs: [localLeg, expressLeg],
          visiblePatternLegFragmentIds: [localLeg.id, expressLeg.id],
        },
      },
    ],
  });
}
interface TopologyProjectionOptions {
  readonly expressMode?: string;
  readonly expressGrade?: 'atGrade' | 'elevated';
  readonly sharedAnchors?: boolean;
  readonly reverseExpressTravel?: boolean;
}
function topologyFallbackProjection(options: TopologyProjectionOptions = {}) {
  const source = aLineSpanChunk();
  const localCarrier = aResolvedCarrier({
    id: 'local-carrier',
    carrier: { kind: 'way', id: 'local-way', laneId: 'local-track' },
    alignmentId: 'local-alignment',
    alignmentRange: [0, 1],
    points: [
      [0, 0],
      [0.001, 0],
    ],
  });
  const expressCarrier = aResolvedCarrier({
    id: 'express-carrier',
    carrier: { kind: 'way', id: 'express-way', laneId: 'express-track' },
    alignmentId: 'express-alignment',
    alignmentRange: [0, 1],
    points: [
      [0, 0.00001],
      [0.001, 0.00001],
    ],
  });
  const localLeg = aResolvedPatternLeg({
    id: 'local-leg',
    logicalPatternLegFragmentId: 'local-logical-leg',
    patternId: 'local-pattern',
    carrierFragmentId: localCarrier.id,
    carrierRange: [0, 1],
    logicalCarrierRange: [0, 1],
    logicalAlignmentRange: [0, 1],
  });
  const expressLeg = aResolvedPatternLeg({
    id: 'express-leg',
    logicalPatternLegFragmentId: 'express-logical-leg',
    patternId: 'express-pattern',
    carrierFragmentId: expressCarrier.id,
    carrierRange: [0, 1],
    logicalCarrierRange: [0, 1],
    logicalAlignmentRange: [0, 1],
    ...(options.reverseExpressTravel ? { direction: 'reverse' as const } : {}),
  });
  const sharedAnchors = options.sharedAnchors ?? true;
  const expressWestStopId = sharedAnchors ? 'stop-west' : 'express-west';
  const expressEastStopId = sharedAnchors ? 'stop-east' : 'express-east';
  const expressCalls = options.reverseExpressTravel
    ? [
        {
          id: 'express-east-call',
          patternId: 'express-pattern',
          stopId: expressEastStopId,
          sequence: 0,
          service: 'served' as const,
          pathAnchor: { legIndex: 0, carrierPosition: 0 },
        },
        {
          id: 'express-west-call',
          patternId: 'express-pattern',
          stopId: expressWestStopId,
          sequence: 1,
          service: 'served' as const,
          pathAnchor: { legIndex: 1, carrierPosition: 0 },
        },
      ]
    : [
        {
          id: 'express-west-call',
          patternId: 'express-pattern',
          stopId: expressWestStopId,
          sequence: 0,
          service: 'served' as const,
          pathAnchor: { legIndex: 0, carrierPosition: 0 },
        },
        {
          id: 'express-east-call',
          patternId: 'express-pattern',
          stopId: expressEastStopId,
          sequence: 1,
          service: 'served' as const,
          pathAnchor: { legIndex: 1, carrierPosition: 0 },
        },
      ];
  return aLineSpanProjection({
    lineOrder: [
      { lineId: 'local', rank: 0 },
      { lineId: 'express', rank: 1 },
    ],
    chunks: [
      {
        ...source,
        entities: {
          ...source.entities,
          lines: [
            { id: 'local', name: 'Local' },
            { id: 'express', name: 'Express' },
          ],
          servicePlans: [
            { id: 'local-plan', mode: { kind: 'known', value: 'bus' }, activity: 'active' },
            {
              id: 'express-plan',
              mode: { kind: 'known', value: options.expressMode ?? 'bus' },
              activity: 'active',
            },
          ],
          patterns: [
            { id: 'local-pattern', path: 'known' },
            { id: 'express-pattern', path: 'known' },
          ],
          stops: [
            {
              id: 'stop-west',
              location: { kind: 'known', value: [0, 0] },
              major: false,
            },
            {
              id: 'stop-east',
              location: { kind: 'known', value: [0.001, 0] },
              major: false,
            },
            ...(sharedAnchors
              ? []
              : [
                  {
                    id: 'express-west',
                    location: { kind: 'known' as const, value: [0, 0] as [number, number] },
                    major: false,
                  },
                  {
                    id: 'express-east',
                    location: {
                      kind: 'known' as const,
                      value: [0.001, 0] as [number, number],
                    },
                    major: false,
                  },
                ]),
          ],
          alignments: [{ id: 'local-alignment' }, { id: 'express-alignment' }],
          ways: [
            {
              id: 'local-way',
              alignmentId: 'local-alignment',
              alignmentExtent: [0, 1],
              typeId: 'rail',
              grade: 'atGrade',
              profile: {
                lanes: [{ id: 'local-track', kindId: 'rail', widthMeters: 3, direction: 'both' }],
              },
            },
            {
              id: 'express-way',
              alignmentId: 'express-alignment',
              alignmentExtent: [0, 1],
              typeId: 'rail',
              grade: options.expressGrade ?? 'atGrade',
              profile: {
                lanes: [{ id: 'express-track', kindId: 'rail', widthMeters: 3, direction: 'both' }],
              },
            },
          ],
        },
        relationships: {
          ...source.relationships,
          lineServicePlans: [
            { id: 'local-plan-link', lineId: 'local', servicePlanId: 'local-plan' },
            { id: 'express-plan-link', lineId: 'express', servicePlanId: 'express-plan' },
          ],
          servicePlanPatterns: [
            { id: 'local-pattern-link', servicePlanId: 'local-plan', patternId: 'local-pattern' },
            {
              id: 'express-pattern-link',
              servicePlanId: 'express-plan',
              patternId: 'express-pattern',
            },
          ],
          patternStopCalls: [
            {
              id: 'local-west-call',
              patternId: 'local-pattern',
              stopId: 'stop-west',
              sequence: 0,
              service: 'served',
              pathAnchor: { legIndex: 0, carrierPosition: 0 },
            },
            {
              id: 'local-east-call',
              patternId: 'local-pattern',
              stopId: 'stop-east',
              sequence: 1,
              service: 'served',
              pathAnchor: { legIndex: 1, carrierPosition: 0 },
            },
            ...expressCalls,
          ],
          topologyWindows: [
            {
              id: 'local-window',
              patternId: 'local-pattern',
              anchoredCalls: [
                { stopCallId: 'local-west-call', patternLegBoundaryIndex: 0 },
                { stopCallId: 'local-east-call', patternLegBoundaryIndex: 1 },
              ],
              patternLegFragmentIds: [localLeg.id],
            },
            {
              id: 'express-window',
              patternId: 'express-pattern',
              anchoredCalls: expressCalls.map((call, index) => ({
                stopCallId: call.id,
                patternLegBoundaryIndex: index,
              })) as [
                { readonly stopCallId: string; readonly patternLegBoundaryIndex: number },
                { readonly stopCallId: string; readonly patternLegBoundaryIndex: number },
              ],
              patternLegFragmentIds: [expressLeg.id],
            },
          ],
        },
        geometry: {
          carriers: [localCarrier, expressCarrier],
          patternLegs: [localLeg, expressLeg],
          visiblePatternLegFragmentIds: [localLeg.id, expressLeg.id],
        },
      },
    ],
  });
}
describe('complete Line bundle materialization', () => {
  it('returns one exact shared-carrier bundle with members in lineOrder', async () => {
    const result = await materializeLineBundles({
      projection: sharedCarrierProjection(),
      carrierRule: 'shared-alignment',
    });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected complete Line bundles.');
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toMatchObject({
      casing: {
        kind: 'exact-carrier',
        canonicalCarrier: { kind: 'alignment', id: 'shared-corridor' },
        canonicalCarrierRange: [0, 1],
      },
      members: [
        { lineId: 'express', spans: [expect.objectContaining({ lineId: 'express' })] },
        { lineId: 'local', spans: [expect.objectContaining({ lineId: 'local' })] },
      ],
    });
    expect(result.visibleFragments.map(({ lineId }) => lineId)).toEqual(['express', 'local']);
  });
  it('uses authored topology anchors to bundle different carriers', async () => {
    const result = await materializeLineBundles({
      projection: topologyFallbackProjection(),
      carrierRule: 'shared-alignment',
    });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected complete Line bundles.');
    expect(result.bundles).toHaveLength(1);
    const bundle = result.bundles[0];
    expect(bundle.casing.kind).toBe('topology');
    expect(bundle.members.map(({ lineId }) => lineId)).toEqual(['local', 'express']);
  });
  it('rejects topology correspondence across known grade separation', async () => {
    await expect(
      materializeLineBundles({
        projection: topologyFallbackProjection({ expressGrade: 'elevated' }),
        carrierRule: 'shared-alignment',
      }),
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'topology-grade-conflict',
      recordId: 'express-window',
    });
  });
  it('does not bundle nearby paths without authored anchors', async () => {
    const result = await materializeLineBundles({
      projection: topologyFallbackProjection({ sharedAnchors: false }),
      carrierRule: 'shared-alignment',
    });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected complete Line bundles.');
    expect(result.bundles.map(({ members }) => members.map(({ lineId }) => lineId))).toEqual([
      ['local'],
      ['express'],
    ]);
  });
  it('rejects topology correspondence without a shared known mode', async () => {
    await expect(
      materializeLineBundles({
        projection: topologyFallbackProjection({ expressMode: 'rail' }),
        carrierRule: 'shared-alignment',
      }),
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'topology-mode-conflict',
      recordId: 'express-window',
    });
  });
  it('keeps a reversed authored topology traversal in one bundle', async () => {
    const result = await materializeLineBundles({
      projection: topologyFallbackProjection({ reverseExpressTravel: true }),
      carrierRule: 'shared-alignment',
    });
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected complete Line bundles.');
    expect(result.bundles[0]?.members.map(({ lineId }) => lineId)).toEqual(['local', 'express']);
  });
  it('returns no bundle aggregate while another result page is pending', async () => {
    await expect(
      materializeLineBundles({
        projection: aLineSpanProjection({ nextCursor: 'next-page' }),
        carrierRule: 'shared-alignment',
      }),
    ).resolves.toEqual({ kind: 'pending', reason: 'more-pages' });
  });
});
