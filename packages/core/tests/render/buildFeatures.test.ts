// Regression test for a line that reads as one continuous route but rendered
// as one disconnected offset copy per way at a bend — see mergeServiceLines.ts
// for the mechanism (line-offset is mitered per-feature, not across a way
// boundary).

import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { wholeLeg, wholeLegs, oneSection } from '../../src/model/geo';
import { wayById } from '../../src/model/geo/wayPath';
import { aRoad, aService, aSystem } from '../support/fixtures';
import type { Pattern, Service } from '../../src/model/system';
import { buildFeatures, type ViewOptions } from '../../src/render/buildFeatures';

const NETWORK_VIEW: ViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
};

describe('buildFeatures service lines', () => {
  it('draws a bundled service on a bent corridor as one line, not one per way', () => {
    // A right-angle bend — a north-south way meeting an east-west one — with
    // TWO services riding both, so the bundle offset is non-zero (a lone
    // service sits at offset 0, where the bug is invisible: offset is what
    // pulls the fragments' endpoints apart at the bend).
    const wayA = aRoad('wayA', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const wayB = aRoad('wayB', [
      [-115.16, 36.14],
      [-115.16, 36.18],
    ]);
    const ways = [wayA, wayB];
    const legs = wholeLegs(wayById(ways), ['wayA', 'wayB']);
    const patternFor = (id: string): Pattern => ({ id, sections: oneSection(legs) });
    const services: Service[] = [
      aService('svc1', [patternFor('p1')]),
      aService('svc2', [patternFor('p2')], { color: '#2e86e4' }),
    ];
    const system = aSystem({ ways, services });

    const fc = buildFeatures(system, null, [], NETWORK_VIEW);
    const svc1Features = fc.services.features.filter(
      (f) => f.properties?.serviceId === 'svc1' && !f.properties?.hitTarget,
    );

    // One continuous feature for svc1's whole route, not one per way.
    expect(svc1Features).toHaveLength(1);
    const coords = svc1Features[0].geometry.coordinates as [number, number][];
    // Both ways' full extent present, in order, with the junction appearing
    // exactly once — proof the two fragments were stitched, not just placed
    // next to each other.
    expect(coords[0]).toEqual([-115.2, 36.14]);
    expect(coords[coords.length - 1]).toEqual([-115.16, 36.18]);
    expect(coords.filter(([lng, lat]) => lng === -115.16 && lat === 36.14)).toHaveLength(1);
  });

  it('keeps repeated-way hit metadata without breaking the painted bend', () => {
    const loop = aRoad('loop', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const bend = aRoad('bend', [
      [-115.16, 36.14],
      [-115.16, 36.18],
    ]);
    const system = aSystem({
      ways: [loop, bend],
      services: [
        aService('other', [
          {
            id: 'through',
            sections: oneSection([wholeLeg('loop'), wholeLeg('bend')]),
          },
        ]),
        aService('svc', [
          {
            id: 'repeat',
            sections: oneSection([wholeLeg('loop'), wholeLeg('bend'), wholeLeg('loop')]),
          },
        ]),
      ],
    });

    const features = buildFeatures(system, null, [], NETWORK_VIEW).services.features;
    const painted = features.filter(
      (feature) => feature.properties?.serviceId === 'svc' && !feature.properties?.hitTarget,
    );
    const hits = features.filter(
      (feature) => feature.properties?.serviceId === 'svc' && feature.properties?.hitTarget,
    );

    expect(painted).toHaveLength(1);
    expect(painted[0].geometry.coordinates).toHaveLength(3);
    expect(painted[0].properties?.offset).not.toBe(0);
    expect(hits.map((feature) => feature.properties?.legIndex).sort()).toEqual([0, 0, 1, 1, 2, 2]);
    expect(hits.every((feature) => feature.properties?.patternId === 'repeat')).toBe(true);
    expect(
      hits.every((feature) => feature.properties?.offset === painted[0].properties?.offset),
    ).toBe(true);
  });

  it('marks painted service features as non-hit targets for MapLibre filters', () => {
    const way = aRoad('way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const system = aSystem({
      ways: [way],
      services: [
        aService('svc', [
          {
            id: 'pattern',
            sections: oneSection([wholeLeg('way')]),
          },
        ]),
      ],
    });

    const features = buildFeatures(system, null, [], NETWORK_VIEW).services.features;
    const painted = features.filter((feature) => feature.properties?.hitTarget !== true);

    // MapLibre's boolean `!` filter does not coerce a missing property to
    // false. Every painted feature therefore carries the explicit complement
    // of the transparent interaction surface's `true` value.
    expect(painted).not.toHaveLength(0);
    expect(painted.every((feature) => feature.properties?.hitTarget === false)).toBe(true);
  });
});

describe('service editing affordances', () => {
  const trunk = aRoad('trunk', [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ]);
  const north = aRoad('north', [
    [-115.19, 36.1],
    [-115.18, 36.11],
  ]);
  const south = aRoad('south', [
    [-115.19, 36.1],
    [-115.18, 36.09],
  ]);
  const service = aService('line', [
    {
      id: 'north-pattern',
      sections: oneSection([wholeLeg('trunk'), wholeLeg('north')]),
    },
    {
      id: 'south-pattern',
      sections: oneSection([wholeLeg('trunk'), wholeLeg('south')]),
    },
  ]);
  const system = aSystem({ ways: [trunk, north, south], services: [service] });

  it('Network service selection produces no corridor control-point handles', () => {
    const features = buildFeatures(
      system,
      { kind: 'service', id: service.id },
      ['trunk', 'north', 'south'],
      NETWORK_VIEW,
    );

    expect(features.handles.features).toEqual([]);
  });

  it('service termini identify every branch side and focused interaction', () => {
    const features = buildFeatures(
      system,
      { kind: 'service', id: service.id },
      [],
      NETWORK_VIEW,
      null,
      null,
      { activePatternId: 'south-pattern' } as never,
    );
    const termini = (
      features as typeof features & {
        serviceTermini?: {
          features: Array<{
            properties: {
              serviceId: string;
              patternId: string;
              side: 'start' | 'end';
              modeId: string;
              interactive: boolean;
            };
            geometry: { coordinates: [number, number] };
          }>;
        };
      }
    ).serviceTermini;

    expect(
      termini?.features.map((feature) => ({
        ...feature.properties,
        at: feature.geometry.coordinates,
      })),
    ).toEqual([
      {
        serviceId: 'line',
        patternId: 'north-pattern',
        side: 'start',
        modeId: 'bus',
        interactive: false,
        at: [-115.2, 36.1],
      },
      {
        serviceId: 'line',
        patternId: 'north-pattern',
        side: 'end',
        modeId: 'bus',
        interactive: true,
        at: [-115.18, 36.11],
      },
      {
        serviceId: 'line',
        patternId: 'south-pattern',
        side: 'start',
        modeId: 'bus',
        interactive: true,
        at: [-115.2, 36.1],
      },
      {
        serviceId: 'line',
        patternId: 'south-pattern',
        side: 'end',
        modeId: 'bus',
        interactive: true,
        at: [-115.18, 36.09],
      },
    ]);
  });

  it('marks only the exact armed terminus as the one-way return origin', () => {
    const features = buildFeatures(
      system,
      { kind: 'service', id: service.id },
      [],
      NETWORK_VIEW,
      null,
      null,
      {
        activePatternId: 'south-pattern',
        armedTerminus: {
          serviceId: 'line',
          patternId: 'south-pattern',
          side: 'end',
        },
      },
    );

    expect(
      features.serviceTermini.features
        .filter((feature) => feature.properties?.armedReturn)
        .map((feature) => feature.properties),
    ).toMatchObject([
      {
        serviceId: 'line',
        patternId: 'south-pattern',
        side: 'end',
        armedReturn: true,
      },
    ]);
  });

  it('does not project service termini into Diagram', () => {
    const features = buildFeatures(system, { kind: 'service', id: service.id }, [], {
      ...NETWORK_VIEW,
      viewMode: 'diagram',
    });

    expect(features.serviceTermini.features).toEqual([]);
  });

  it('Infrastructure service selection retains corridor control points', () => {
    const features = buildFeatures(
      system,
      { kind: 'service', id: service.id },
      ['trunk', 'north', 'south'],
      { ...NETWORK_VIEW, viewMode: 'infrastructure' },
    );

    expect(features.handles.features).toHaveLength(6);
  });
});
