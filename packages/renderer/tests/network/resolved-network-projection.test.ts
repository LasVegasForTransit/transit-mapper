import { describe, expect, it } from 'vitest';
import { wholeLeg } from '@transitmapper/core/model/geo/servicePaths';
import { transitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { ContentRef } from '@transitmapper/core/network/content-reference';
import type { NetworkQuery } from '@transitmapper/core/network/query';
import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import { createSchemaV16SystemProvider } from '@transitmapper/core/network/schema-v16-system-provider';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { projectResolvedNetwork } from '../../src/projection';

const presentation = renderPresentationForViewport({
  center: [-115.17, 36.12],
  zoom: 12,
  width: 1_280,
  height: 720,
});

const query: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -116, south: 35, east: -114, north: 37 },
  detailBand: 'district',
};

function latestSystemReference(id: string): ContentRef {
  return {
    kind: 'transit-system',
    id,
    revision: { kind: 'latest' },
  };
}

async function schemaV16Result(): Promise<NetworkQueryResult> {
  const way = aRoad('way', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const service = aService('service', [
    {
      id: 'path',
      sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }],
    },
  ]);
  const system = aSystem({ ways: [way], services: [service] });
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe(latestSystemReference(system.id));
  return provider.resolve(descriptor.content, query);
}

interface DatasetResultOptions {
  readonly knownPatternPath?: 'known' | 'unknown';
  readonly visiblePatternLegFragmentIds?: readonly string[];
}

function datasetResult(options: DatasetResultOptions = {}): NetworkQueryResult {
  return {
    descriptor: {
      content: {
        kind: 'transit-dataset',
        id: 'dataset',
        datasetRevisionId: 'revision',
        operational: { kind: 'planned' },
      },
      map: {
        defaultRepresentationId: 'network',
        representationIds: ['network'],
        modeIds: ['bus'],
        defaultModeIds: ['bus'],
        filters: [],
      },
      attributions: [],
      licenses: [],
      sources: [],
    },
    coverage: [
      {
        area: { kind: 'unknown' },
        sourceIds: ['source'],
        coverage: 'inside',
        availability: 'available',
        freshness: 'fresh',
        serviceEvidence: 'present',
        filterEffect: 'included',
      },
    ],
    lineOrder: [
      { lineId: 'line-b', rank: 0 },
      { lineId: 'line-a', rank: 1 },
    ],
    chunks: [
      {
        id: 'west',
        entities: {
          lines: [{ id: 'line-b', name: 'Line B' }],
          servicePlans: [
            {
              id: 'plan',
              mode: { kind: 'known', value: 'bus' },
              activity: 'active',
            },
          ],
          patterns: [
            { id: 'known-pattern', path: options.knownPatternPath ?? 'known' },
            { id: 'unknown-pattern', path: 'unknown' },
          ],
          stops: [
            {
              id: 'stop',
              location: { kind: 'known', value: [-115.17, 36.12] },
              stationId: 'station',
              major: false,
            },
          ],
          stations: [
            {
              id: 'station',
              location: { kind: 'known', value: [-115.17, 36.12] },
            },
          ],
          alignments: [{ id: 'alignment' }],
          ways: [
            {
              id: 'way',
              alignmentId: 'alignment',
              alignmentExtent: [0, 1],
              typeId: 'road',
              grade: 'atGrade',
              profile: { lanes: [] },
            },
          ],
        },
        relationships: {
          lineServicePlans: [{ id: 'line-plan', lineId: 'line-b', servicePlanId: 'plan' }],
          servicePlanPatterns: [
            {
              id: 'plan-known-pattern',
              servicePlanId: 'plan',
              patternId: 'known-pattern',
            },
            {
              id: 'plan-unknown-pattern',
              servicePlanId: 'plan',
              patternId: 'unknown-pattern',
            },
          ],
          patternStopCalls: [
            {
              id: 'call-start',
              patternId: 'known-pattern',
              stopId: 'stop',
              sequence: 0,
              service: 'served',
              pathAnchor: { legIndex: 0, carrierPosition: 0 },
            },
            {
              id: 'call-end',
              patternId: 'known-pattern',
              stopId: 'stop',
              sequence: 1,
              service: 'served',
              pathAnchor: { legIndex: 0, carrierPosition: 1 },
            },
          ],
          topologyWindows: [
            {
              id: 'window',
              patternId: 'known-pattern',
              anchoredCalls: [
                { stopCallId: 'call-start', patternLegBoundaryIndex: 0 },
                { stopCallId: 'call-end', patternLegBoundaryIndex: 2 },
              ],
              patternLegFragmentIds: ['topology-leg', 'later-page-leg'],
            },
          ],
          replacements: [],
        },
        geometry: {
          carriers: [
            {
              id: 'visible-carrier',
              carrier: { kind: 'way', id: 'way' },
              alignmentId: 'alignment',
              alignmentRange: [0, 1],
              points: [
                [-115.2, 36.1],
                [-115.15, 36.1],
              ],
              geometry: 'straight',
              curveControls: [],
            },
            {
              id: 'topology-carrier',
              carrier: { kind: 'way', id: 'way' },
              alignmentId: 'alignment',
              alignmentRange: [0, 1],
              points: [
                [-115.15, 36.1],
                [-115.1, 36.1],
              ],
              geometry: 'straight',
              curveControls: [],
            },
          ],
          patternLegs: [
            {
              id: 'visible-leg',
              logicalPatternLegFragmentId: 'logical-leg',
              patternId: 'known-pattern',
              legIndex: 0,
              carrierFragmentId: 'visible-carrier',
              carrierRange: [0, 0.5],
              logicalCarrierRange: [0, 1],
              logicalAlignmentRange: [0, 1],
              direction: 'forward',
            },
            {
              id: 'topology-leg',
              logicalPatternLegFragmentId: 'logical-leg',
              patternId: 'known-pattern',
              legIndex: 0,
              carrierFragmentId: 'topology-carrier',
              carrierRange: [0.5, 1],
              logicalCarrierRange: [0, 1],
              logicalAlignmentRange: [0, 1],
              direction: 'forward',
            },
          ],
          visiblePatternLegFragmentIds: options.visiblePatternLegFragmentIds ?? ['visible-leg'],
        },
        operationalChanges: [],
        advisories: [
          {
            id: 'advisory',
            affected: [{ kind: 'line', id: 'line-b' }],
            text: [{ description: 'Use the south entrance.' }],
            source: {
              sourceIds: ['source'],
              sourceRevisionIds: ['source-revision'],
            },
          },
        ],
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
      },
      {
        id: 'east',
        entities: {
          lines: [{ id: 'line-a', name: 'Line A' }],
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
      },
    ],
    nextCursor: 'page-2',
  };
}

describe('resolved network projection', () => {
  it('projects schema-v16 provider results through the public renderer entry', async () => {
    const result = await schemaV16Result();
    const projection = projectResolvedNetwork(result, presentation);

    expect(projection.result).toBe(result);
    expect(projection.presentation).toBe(presentation);
    expect(projection.index.linesById.get('service')).toMatchObject({ id: 'service' });
    expect(projection.index.servicePlansById.get('service')).toMatchObject({ id: 'service' });
    expect(projection.index.patternsById.size).toBe(2);
    expect(projection.index.linePatternsByLineId.get('service')).toHaveLength(2);
  });

  it('indexes dataset-shaped results without changing provider status or order', () => {
    const result = datasetResult();
    const projection = projectResolvedNetwork(result, presentation);

    expect(projection.result.coverage).toBe(result.coverage);
    expect(projection.result.lineOrder).toBe(result.lineOrder);
    expect(projection.result.lineOrder.map(({ lineId }) => lineId)).toEqual(['line-b', 'line-a']);
    expect(projection.result.chunks.map(({ id }) => id)).toEqual(['west', 'east']);
    expect(projection.result.nextCursor).toBe('page-2');
    expect([...projection.index.linesById.keys()]).toEqual(['line-b', 'line-a']);
    expect(projection.index.patternsById.get('unknown-pattern')).toEqual({
      id: 'unknown-pattern',
      path: 'unknown',
    });
    expect(projection.index.stopsById.has('stop')).toBe(true);
    expect(projection.index.stationsById.has('station')).toBe(true);
    expect(projection.index.alignmentsById.has('alignment')).toBe(true);
    expect(projection.index.waysById.has('way')).toBe(true);
    expect(projection.index.advisoriesById.has('advisory')).toBe(true);
    expect(
      projection.index.advisoriesByAffectedEntity.get(
        transitEntityKey({ kind: 'line', id: 'line-b' }),
      ),
    ).toHaveLength(1);
  });

  it('keeps topology evidence out of visible route geometry', () => {
    const projection = projectResolvedNetwork(datasetResult(), presentation);

    expect([...projection.index.patternLegFragmentsById.keys()]).toEqual([
      'visible-leg',
      'topology-leg',
    ]);
    expect(
      projection.index.visiblePatternLegFragmentsByPatternId
        .get('known-pattern')
        ?.map(({ id }) => id),
    ).toEqual(['visible-leg']);
    expect(
      projection.index.topologyWindowsByPatternId.get('known-pattern')?.[0]?.patternLegFragmentIds,
    ).toEqual(['topology-leg', 'later-page-leg']);
    expect(projection.index.topologyWindowsById.get('window')).toBe(
      projection.index.topologyWindowsByPatternId.get('known-pattern')?.[0],
    );
  });

  it('rejects visible geometry that lacks a supplied known path', () => {
    expect(() =>
      projectResolvedNetwork(
        datasetResult({ visiblePatternLegFragmentIds: ['missing-leg'] }),
        presentation,
      ),
    ).toThrow(/visible Pattern leg fragment "missing-leg" is missing/i);
    expect(() =>
      projectResolvedNetwork(datasetResult({ knownPatternPath: 'unknown' }), presentation),
    ).toThrow(/has no known Pattern path/i);
  });
});
