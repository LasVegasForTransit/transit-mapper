import { describe, expect, it } from 'vitest';
import { canonicalValueBytes } from '../../../src/encoding/canonical-value';
import type { ResolvedNetworkChunk } from '../../../src/network/resolved-network-chunk';

const chunk: ResolvedNetworkChunk = {
  id: 'downtown-page-1',
  entities: {
    lines: [{ id: 'line-220', name: 'Ann / Tropical', publicCode: '220', color: '#00a56a' }],
    servicePlans: [
      {
        id: 'plan-weekday',
        name: 'Weekday',
        mode: { kind: 'known', value: 'bus' },
        activity: 'active',
      },
    ],
    patterns: [
      {
        id: 'pattern-eastbound',
        direction: { key: 'eastbound', label: 'Eastbound' },
        path: 'known',
      },
      { id: 'pattern-short-turn', path: 'unknown' },
    ],
    stops: [
      {
        id: 'stop-before',
        name: 'Deer Springs before Riley',
        location: { kind: 'known', value: [-115.31, 36.28] },
        stationId: 'station-deer-springs',
        major: false,
      },
      {
        id: 'stop-after',
        name: 'Grand Montecito after Deer Springs',
        location: { kind: 'unknown' },
        major: true,
      },
    ],
    stations: [
      {
        id: 'station-deer-springs',
        name: 'Deer Springs',
        location: { kind: 'known', value: [-115.3, 36.28] },
      },
    ],
    alignments: [{ id: 'alignment-deer-springs' }],
    ways: [
      {
        id: 'way-deer-springs',
        alignmentId: 'alignment-deer-springs',
        alignmentExtent: [0, 1],
        typeId: 'road',
        grade: 'atGrade',
        profile: {
          lanes: [
            {
              id: 'eastbound-lane',
              kindId: 'bus',
              widthMeters: 3.5,
              direction: 'forward',
            },
          ],
        },
      },
    ],
  },
  relationships: {
    lineServicePlans: [{ id: 'line-plan-link', lineId: 'line-220', servicePlanId: 'plan-weekday' }],
    servicePlanPatterns: [
      {
        id: 'plan-pattern-link',
        servicePlanId: 'plan-weekday',
        patternId: 'pattern-eastbound',
      },
    ],
    patternStopCalls: [
      {
        id: 'call-before',
        patternId: 'pattern-eastbound',
        stopId: 'stop-before',
        sequence: 3,
        service: 'served',
        pathAnchor: { legIndex: 2, carrierPosition: 0.25 },
      },
      {
        id: 'call-after',
        patternId: 'pattern-eastbound',
        stopId: 'stop-after',
        sequence: 4,
        service: 'skipped',
        pathAnchor: { legIndex: 3, carrierPosition: 0.75 },
      },
    ],
    topologyWindows: [
      {
        id: 'window-before-after',
        patternId: 'pattern-eastbound',
        anchoredCalls: [
          { stopCallId: 'call-before', patternLegBoundaryIndex: 0 },
          { stopCallId: 'call-after', patternLegBoundaryIndex: 2 },
        ],
        patternLegFragmentIds: ['leg-visible', 'leg-topology-only'],
      },
    ],
    replacements: [
      {
        id: 'replacement-link',
        replacement: { kind: 'service-plan', id: 'plan-shuttle' },
        target: { kind: 'service-plan', id: 'plan-weekday' },
      },
    ],
  },
  geometry: {
    carriers: [
      {
        id: 'carrier-visible',
        carrier: { kind: 'way', id: 'way-deer-springs', laneId: 'eastbound-lane' },
        alignmentId: 'alignment-deer-springs',
        alignmentRange: [0.2, 0.5],
        points: [
          [-115.31, 36.28],
          [-115.3, 36.28],
          [-115.29, 36.27],
        ],
        geometry: 'curved',
        curveControls: [{ pointIndex: 1, radiusMeters: 12 }],
      },
      {
        id: 'carrier-topology-only',
        carrier: { kind: 'alignment', id: 'alignment-deer-springs' },
        alignmentId: 'alignment-deer-springs',
        alignmentRange: [0.5, 0.8],
        points: [
          [-115.29, 36.27],
          [-115.28, 36.26],
        ],
        geometry: 'straight',
        curveControls: [],
      },
    ],
    patternLegs: [
      {
        id: 'leg-visible',
        logicalPatternLegFragmentId: 'logical-leg-visible',
        patternId: 'pattern-eastbound',
        legIndex: 2,
        carrierFragmentId: 'carrier-visible',
        carrierRange: [0.2, 0.5],
        logicalCarrierRange: [0.2, 0.5],
        logicalAlignmentRange: [0.2, 0.5],
        direction: 'forward',
      },
      {
        id: 'leg-topology-only',
        logicalPatternLegFragmentId: 'logical-leg-topology-only',
        patternId: 'pattern-eastbound',
        legIndex: 3,
        carrierFragmentId: 'carrier-topology-only',
        carrierRange: [0.5, 0.8],
        logicalCarrierRange: [0.5, 0.8],
        logicalAlignmentRange: [0.5, 0.8],
        direction: 'forward',
      },
    ],
    visiblePatternLegFragmentIds: ['leg-visible'],
  },
  operationalChanges: [
    {
      id: 'change-shuttle',
      kind: 'shuttle',
      label: 'Shuttle replaces weekday service',
      affected: [{ kind: 'service-plan', id: 'plan-weekday' }],
      scope: { kind: 'service-dates', serviceDates: ['2026-08-29'] },
      replacements: [
        {
          id: 'change-replacement-link',
          replacement: { kind: 'service-plan', id: 'plan-shuttle' },
          target: { kind: 'service-plan', id: 'plan-weekday' },
        },
      ],
      source: {
        sourceIds: ['rtc-realtime'],
        sourceRevisionIds: ['rtc-realtime-42'],
        lastUpdatedAt: '2026-08-29T07:00:00Z',
      },
    },
  ],
  advisories: [
    {
      id: 'advisory-shuttle',
      affected: [{ kind: 'line', id: 'line-220' }],
      cause: 'construction',
      effect: 'shuttle-service',
      text: [{ language: 'en', header: 'Shuttle service', description: 'Use the shuttle.' }],
      source: {
        sourceIds: ['rtc-realtime'],
        sourceRevisionIds: ['rtc-realtime-42'],
      },
    },
  ],
  infrastructure: {
    nodes: [
      {
        id: 'node-intersection',
        location: { kind: 'known', value: [-115.3, 36.28] },
        wayPoints: [{ wayId: 'way-deer-springs', pointIndex: 1 }],
        controlId: 'signal',
      },
    ],
    namedWays: [
      { id: 'named-deer-springs', name: 'Deer Springs Way', wayIds: ['way-deer-springs'] },
    ],
    medians: [
      {
        id: 'median-deer-springs',
        namedWayId: 'named-deer-springs',
        widthMeters: 4,
        kindId: 'raised',
      },
    ],
    laneConnectors: [
      {
        id: 'connector-eastbound',
        nodeId: 'node-intersection',
        from: { wayId: 'way-deer-springs', laneId: 'eastbound-lane' },
        to: { wayId: 'way-deer-springs', laneId: 'eastbound-lane' },
      },
    ],
    turnRestrictions: [
      {
        id: 'restriction-through-only',
        from: { wayId: 'way-deer-springs', laneIds: { kind: 'all' } },
        to: {
          wayId: 'way-deer-springs',
          laneIds: { kind: 'only', values: ['eastbound-lane'] },
        },
        via: { kind: 'node', nodeId: 'node-intersection' },
        movement: 'only',
        modeIds: { kind: 'unknown' },
      },
      {
        id: 'restriction-no-turn-through-ways',
        from: { wayId: 'way-deer-springs', laneIds: { kind: 'unknown' } },
        to: { wayId: 'way-deer-springs', laneIds: { kind: 'all' } },
        via: { kind: 'ways', wayIds: ['way-deer-springs'] },
        movement: 'prohibited',
        modeIds: { kind: 'only', values: ['bus'] },
      },
    ],
    approachControls: [
      {
        id: 'approach-eastbound',
        nodeId: 'node-intersection',
        wayId: 'way-deer-springs',
        end: 'end',
        controlId: 'signal',
      },
    ],
    facilities: [
      {
        id: 'facility-park-and-ride',
        typeId: 'park-and-ride',
        name: 'Centennial Hills',
        location: [-115.31, 36.28],
      },
    ],
    groups: [{ id: 'group-centennial', name: 'Centennial complex', color: '#00a56a' }],
    groupMembers: [
      {
        id: 'group-stop-link',
        groupId: 'group-centennial',
        member: { kind: 'stop', id: 'stop-before' },
      },
    ],
    areas: [
      {
        id: 'station-footprint',
        owner: { kind: 'station', id: 'station-deer-springs' },
        polygon: {
          outer: [
            [-115.301, 36.279],
            [-115.299, 36.279],
            [-115.299, 36.281],
            [-115.301, 36.279],
          ],
          holes: [],
        },
      },
      {
        id: 'facility-footprint',
        owner: { kind: 'facility', id: 'facility-park-and-ride' },
        polygon: {
          outer: [
            [-115.302, 36.279],
            [-115.301, 36.279],
            [-115.301, 36.28],
            [-115.302, 36.279],
          ],
          holes: [],
        },
      },
      {
        id: 'group-footprint',
        owner: { kind: 'group', id: 'group-centennial' },
        polygon: {
          outer: [
            [-115.303, 36.279],
            [-115.302, 36.279],
            [-115.302, 36.28],
            [-115.303, 36.279],
          ],
          holes: [],
        },
      },
    ],
  },
};

describe('resolved network chunks', () => {
  it('keeps topology evidence separate from visible route geometry', () => {
    expect(chunk.relationships.topologyWindows[0]?.anchoredCalls).toEqual([
      { stopCallId: 'call-before', patternLegBoundaryIndex: 0 },
      { stopCallId: 'call-after', patternLegBoundaryIndex: 2 },
    ]);
    expect(chunk.relationships.topologyWindows[0]?.patternLegFragmentIds).toEqual([
      'leg-visible',
      'leg-topology-only',
    ]);
    expect(chunk.geometry.visiblePatternLegFragmentIds).toEqual(['leg-visible']);
  });

  it('gives repeated complete records one canonical comparison value', () => {
    expect(canonicalValueBytes(structuredClone(chunk))).toEqual(canonicalValueBytes(chunk));
  });

  it('preserves supplied stop-call anchors and fragment-local curve controls', () => {
    expect(chunk.relationships.patternStopCalls.map(({ pathAnchor }) => pathAnchor)).toEqual([
      { legIndex: 2, carrierPosition: 0.25 },
      { legIndex: 3, carrierPosition: 0.75 },
    ]);
    expect(chunk.geometry.carriers[0]?.curveControls).toEqual([
      { pointIndex: 1, radiusMeters: 12 },
    ]);
  });

  it('carries operational replacements and provider-neutral infrastructure', () => {
    expect(chunk.operationalChanges[0]?.replacements[0]?.target).toEqual({
      kind: 'service-plan',
      id: 'plan-weekday',
    });
    expect(chunk.infrastructure.nodes.map(({ id }) => id)).toEqual(['node-intersection']);
    expect(chunk.infrastructure.namedWays.map(({ id }) => id)).toEqual(['named-deer-springs']);
    expect(chunk.infrastructure.medians.map(({ id }) => id)).toEqual(['median-deer-springs']);
    expect(chunk.infrastructure.laneConnectors.map(({ id }) => id)).toEqual([
      'connector-eastbound',
    ]);
    expect(chunk.infrastructure.approachControls.map(({ id }) => id)).toEqual([
      'approach-eastbound',
    ]);
    expect(chunk.infrastructure.facilities.map(({ id }) => id)).toEqual(['facility-park-and-ride']);
    expect(chunk.infrastructure.groups.map(({ id }) => id)).toEqual(['group-centennial']);
    expect(chunk.infrastructure.groupMembers.map(({ id }) => id)).toEqual(['group-stop-link']);
    expect(chunk.infrastructure.areas.map(({ owner }) => owner.kind)).toEqual([
      'station',
      'facility',
      'group',
    ]);
    expect(chunk.infrastructure.turnRestrictions.map(({ via }) => via.kind)).toEqual([
      'node',
      'ways',
    ]);
  });
});
