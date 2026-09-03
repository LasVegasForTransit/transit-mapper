import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from './line-spans.test';

export function sharedCarrierProjection() {
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
