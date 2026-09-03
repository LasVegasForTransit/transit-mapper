import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type {
  ResolvedCarrierFragment,
  ResolvedNetworkChunk,
  ResolvedPatternLegFragment,
} from '@transitmapper/core/network/resolved-network-chunk';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import type { LineOrderEntry } from '@transitmapper/core/transit/value-types';
import { projectResolvedNetwork, type ResolvedNetworkProjection } from '../../src/projection';

export const lineSpanPresentation = renderPresentationForViewport({
  center: [0, 0],
  zoom: 12,
  width: 1_280,
  height: 720,
});

export function aResolvedCarrier(
  overrides: Partial<ResolvedCarrierFragment> = {},
): ResolvedCarrierFragment {
  return {
    id: 'carrier-shard',
    carrier: { kind: 'alignment', id: 'alignment' },
    alignmentId: 'alignment',
    alignmentRange: [0.25, 0.75],
    points: [
      [-0.5, 0],
      [0.5, 0],
    ],
    geometry: 'straight',
    curveControls: [],
    ...overrides,
  };
}

export function aResolvedPatternLeg(
  overrides: Partial<ResolvedPatternLegFragment> = {},
): ResolvedPatternLegFragment {
  return {
    id: 'leg-shard',
    logicalPatternLegFragmentId: 'logical-leg',
    patternId: 'pattern',
    legIndex: 0,
    carrierFragmentId: 'carrier-shard',
    carrierRange: [0.25, 0.75],
    logicalCarrierRange: [0, 1],
    logicalAlignmentRange: [0, 1],
    direction: 'forward',
    ...overrides,
  };
}

export function anEmptyResolvedChunk(id = 'chunk'): ResolvedNetworkChunk {
  return {
    id,
    entities: {
      lines: [],
      servicePlans: [],
      patterns: [],
      stops: [],
      stations: [],
      alignments: [],
      ways: [],
    },
    relationships: {
      lineServicePlans: [],
      servicePlanPatterns: [],
      patternStopCalls: [],
      topologyWindows: [],
      replacements: [],
    },
    geometry: {
      carriers: [],
      patternLegs: [],
      visiblePatternLegFragmentIds: [],
    },
    operationalChanges: [],
    advisories: [],
    infrastructure: {
      nodes: [],
      namedWays: [],
      medians: [],
      laneConnectors: [],
      turnRestrictions: [],
      approachControls: [],
      facilities: [],
      groups: [],
      groupMembers: [],
      areas: [],
    },
  };
}

export function aLineSpanChunk(): ResolvedNetworkChunk {
  const chunk = anEmptyResolvedChunk();
  return {
    ...chunk,
    entities: {
      ...chunk.entities,
      lines: [{ id: 'line', name: 'Line' }],
      servicePlans: [{ id: 'plan', mode: { kind: 'known', value: 'bus' }, activity: 'active' }],
      patterns: [{ id: 'pattern', path: 'known' }],
      alignments: [{ id: 'alignment' }],
    },
    relationships: {
      ...chunk.relationships,
      lineServicePlans: [{ id: 'line-plan', lineId: 'line', servicePlanId: 'plan' }],
      servicePlanPatterns: [{ id: 'plan-pattern', servicePlanId: 'plan', patternId: 'pattern' }],
    },
    geometry: {
      carriers: [aResolvedCarrier()],
      patternLegs: [aResolvedPatternLeg()],
      visiblePatternLegFragmentIds: ['leg-shard'],
    },
  };
}

interface LineSpanResultOptions {
  readonly chunks?: readonly ResolvedNetworkChunk[];
  readonly lineOrder?: readonly LineOrderEntry[];
  readonly nextCursor?: string;
}

export function aLineSpanResult(options: LineSpanResultOptions = {}): NetworkQueryResult {
  return {
    descriptor: {
      content: {
        kind: 'transit-dataset',
        id: 'dataset',
        datasetRevisionId: 'revision',
        operational: { kind: 'planned' },
      },
      map: {
        defaultRepresentationId: 'passenger',
        representationIds: ['passenger'],
        modeIds: ['bus'],
        defaultModeIds: ['bus'],
        filters: [],
      },
      attributions: [],
      licenses: [],
      sources: [],
    },
    coverage: [],
    lineOrder: options.lineOrder ?? [{ lineId: 'line', rank: 0 }],
    chunks: options.chunks ?? [aLineSpanChunk()],
    ...(options.nextCursor === undefined ? {} : { nextCursor: options.nextCursor }),
  };
}

export function aLineSpanProjection(
  options: LineSpanResultOptions = {},
): ResolvedNetworkProjection {
  return projectResolvedNetwork(aLineSpanResult(options), lineSpanPresentation);
}
