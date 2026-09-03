import { describe, expect, it } from 'vitest';
import type { ResolvedNetworkChunk } from '@transitmapper/core/network/resolved-network-chunk';
import { projectResolvedNetwork } from '../../src/network/resolved-network-projection';
import {
  aLineSpanChunk,
  aLineSpanResult,
  anEmptyResolvedChunk,
  lineSpanPresentation,
} from '../support/line-spans.test';

const duplicateKinds = [
  'Advisory',
  'Alignment',
  'Line',
  'Line ServicePlan link',
  'Pattern',
  'Pattern leg fragment',
  'Pattern stop call',
  'ServicePlan',
  'ServicePlan Pattern link',
  'Station',
  'Stop',
  'Way',
  'carrier fragment',
  'topology window',
] as const;

type DuplicateKind = (typeof duplicateKinds)[number];

interface DuplicateFixture {
  readonly first: ResolvedNetworkChunk;
  readonly second: ResolvedNetworkChunk;
}

function reorderedClone<Value extends object>(value: Value): Value {
  const clone = structuredClone(value);
  return Object.fromEntries(Object.entries(clone).reverse()) as Value;
}

function firstChunk(): ResolvedNetworkChunk {
  const base = aLineSpanChunk();
  return {
    ...base,
    entities: {
      ...base.entities,
      stops: [
        {
          id: 'stop',
          location: { kind: 'known', value: [0, 0] },
          stationId: 'station',
          major: false,
        },
      ],
      stations: [{ id: 'station', location: { kind: 'unknown' } }],
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
      ...base.relationships,
      patternStopCalls: [
        {
          id: 'call-start',
          patternId: 'pattern',
          stopId: 'stop',
          sequence: 0,
          service: 'served',
          pathAnchor: { legIndex: 0, carrierPosition: 0 },
        },
        {
          id: 'call-end',
          patternId: 'pattern',
          stopId: 'stop',
          sequence: 1,
          service: 'served',
          pathAnchor: { legIndex: 0, carrierPosition: 1 },
        },
      ],
      topologyWindows: [
        {
          id: 'window',
          patternId: 'pattern',
          anchoredCalls: [
            { stopCallId: 'call-start', patternLegBoundaryIndex: 0 },
            { stopCallId: 'call-end', patternLegBoundaryIndex: 1 },
          ],
          patternLegFragmentIds: ['leg-shard'],
        },
      ],
    },
    advisories: [
      {
        id: 'advisory',
        affected: [{ kind: 'line', id: 'line' }],
        text: [{ description: 'Notice' }],
        source: { sourceIds: ['source'], sourceRevisionIds: ['revision'] },
      },
    ],
  };
}

function equalDuplicate(first: ResolvedNetworkChunk): ResolvedNetworkChunk {
  const empty = anEmptyResolvedChunk('duplicate');
  const calls = first.relationships.patternStopCalls.map(reorderedClone);
  return {
    ...empty,
    entities: {
      lines: [reorderedClone(first.entities.lines[0])],
      servicePlans: [reorderedClone(first.entities.servicePlans[0])],
      patterns: [reorderedClone(first.entities.patterns[0])],
      stops: [reorderedClone(first.entities.stops[0])],
      stations: [reorderedClone(first.entities.stations[0])],
      alignments: [reorderedClone(first.entities.alignments[0])],
      ways: [reorderedClone(first.entities.ways[0])],
    },
    relationships: {
      ...empty.relationships,
      lineServicePlans: [reorderedClone(first.relationships.lineServicePlans[0])],
      servicePlanPatterns: [reorderedClone(first.relationships.servicePlanPatterns[0])],
      patternStopCalls: [{ ...calls[0], sequence: -0 }, ...calls.slice(1)],
      topologyWindows: [reorderedClone(first.relationships.topologyWindows[0])],
    },
    geometry: {
      ...empty.geometry,
      carriers: [reorderedClone(first.geometry.carriers[0])],
      patternLegs: [reorderedClone(first.geometry.patternLegs[0])],
    },
    advisories: [reorderedClone(first.advisories[0])],
  };
}

function conflict(kind: DuplicateKind, chunk: ResolvedNetworkChunk): ResolvedNetworkChunk {
  switch (kind) {
    case 'Advisory':
      return { ...chunk, advisories: [{ ...chunk.advisories[0], cause: 'conflict' }] };
    case 'Alignment':
      return {
        ...chunk,
        entities: { ...chunk.entities, alignments: [{ ...chunk.entities.alignments[0], x: true }] },
      } as unknown as ResolvedNetworkChunk;
    case 'Line':
      return {
        ...chunk,
        entities: { ...chunk.entities, lines: [{ ...chunk.entities.lines[0], name: 'Conflict' }] },
      };
    case 'Line ServicePlan link':
      return {
        ...chunk,
        relationships: {
          ...chunk.relationships,
          lineServicePlans: [{ ...chunk.relationships.lineServicePlans[0], lineId: 'other' }],
        },
      };
    case 'Pattern':
      return {
        ...chunk,
        entities: {
          ...chunk.entities,
          patterns: [{ ...chunk.entities.patterns[0], path: 'unknown' }],
        },
      };
    case 'Pattern leg fragment':
      return {
        ...chunk,
        geometry: {
          ...chunk.geometry,
          patternLegs: [{ ...chunk.geometry.patternLegs[0], direction: 'reverse' }],
        },
      };
    case 'Pattern stop call':
      return {
        ...chunk,
        relationships: {
          ...chunk.relationships,
          patternStopCalls: [{ ...chunk.relationships.patternStopCalls[0], sequence: 1 }],
        },
      };
    case 'ServicePlan':
      return {
        ...chunk,
        entities: {
          ...chunk.entities,
          servicePlans: [{ ...chunk.entities.servicePlans[0], activity: 'inactive' }],
        },
      };
    case 'ServicePlan Pattern link':
      return {
        ...chunk,
        relationships: {
          ...chunk.relationships,
          servicePlanPatterns: [
            { ...chunk.relationships.servicePlanPatterns[0], patternId: 'other' },
          ],
        },
      };
    case 'Station':
      return {
        ...chunk,
        entities: {
          ...chunk.entities,
          stations: [{ ...chunk.entities.stations[0], name: 'Conflict' }],
        },
      };
    case 'Stop':
      return {
        ...chunk,
        entities: { ...chunk.entities, stops: [{ ...chunk.entities.stops[0], major: true }] },
      };
    case 'Way':
      return {
        ...chunk,
        entities: { ...chunk.entities, ways: [{ ...chunk.entities.ways[0], typeId: 'rail' }] },
      };
    case 'carrier fragment':
      return {
        ...chunk,
        geometry: {
          ...chunk.geometry,
          carriers: [
            {
              ...chunk.geometry.carriers[0],
              points: [
                [-0.5, 0],
                [0.6, 0],
              ],
            },
          ],
        },
      };
    case 'topology window':
      return {
        ...chunk,
        relationships: {
          ...chunk.relationships,
          topologyWindows: [
            {
              ...chunk.relationships.topologyWindows[0],
              patternLegFragmentIds: ['different-leg'],
            },
          ],
        },
      };
  }
}

function duplicateFixture(kind?: DuplicateKind): DuplicateFixture {
  const first = firstChunk();
  const equal = equalDuplicate(first);
  return { first, second: kind === undefined ? equal : conflict(kind, equal) };
}

function projection(fixture: DuplicateFixture, reverse = false) {
  const chunks = reverse ? [fixture.second, fixture.first] : [fixture.first, fixture.second];
  return projectResolvedNetwork(aLineSpanResult({ chunks }), lineSpanPresentation);
}

describe('resolved network duplicate records', () => {
  it('coalesces canonical equals with distinct objects and property order', () => {
    const result = projection(duplicateFixture());

    expect(result.index.linesById.size).toBe(1);
    expect(result.index.servicePlansById.size).toBe(1);
    expect(result.index.patternsById.size).toBe(1);
    expect(result.index.stopsById.size).toBe(1);
    expect(result.index.stationsById.size).toBe(1);
    expect(result.index.alignmentsById.size).toBe(1);
    expect(result.index.waysById.size).toBe(1);
    expect(result.index.linePatternsByPatternId.get('pattern')).toHaveLength(1);
    expect(result.index.stopCallsById.size).toBe(2);
    expect(result.index.topologyWindowsByPatternId.get('pattern')).toHaveLength(1);
    expect(result.index.carrierFragmentsById.size).toBe(1);
    expect(result.index.patternLegFragmentsById.size).toBe(1);
    expect(result.index.advisoriesById.size).toBe(1);
  });

  it.each(duplicateKinds)('rejects conflicting duplicate %s records', (kind) => {
    const fixture = duplicateFixture(kind);

    expect(() => projection(fixture)).toThrow(new RegExp(`conflicting ${kind} id`, 'i'));
    expect(() => projection(fixture, true)).toThrow(new RegExp(`conflicting ${kind} id`, 'i'));
  });

  it('reports the same first conflict regardless of encounter order', () => {
    const fixture = duplicateFixture('Line');
    const second = conflict('Advisory', fixture.second);
    const multiple = { ...fixture, second };

    expect(() => projection(multiple)).toThrow(/conflicting advisory id "advisory"/i);
    expect(() => projection(multiple, true)).toThrow(/conflicting advisory id "advisory"/i);
  });
});
