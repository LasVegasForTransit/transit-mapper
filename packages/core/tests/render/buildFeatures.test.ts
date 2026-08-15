// Service paint remains corridor-owned so an incremental projection can
// replace one way without erasing an adjacent way's unchanged fragment.

import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { wholeLeg, wholeLegs, oneSection } from '../../src/model/geo';
import { wayById } from '../../src/model/geo/wayPath';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';
import type { Pattern, Service } from '../../src/model/system';
import { buildFeatures, type RenderViewOptions } from '../../src/render/buildFeatures';
import { OVERVIEW_TEST_PRESENTATION } from '../support/render-presentation.test';

const NETWORK_VIEW: RenderViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
  presentation: OVERVIEW_TEST_PRESENTATION,
};

function featureProperty(feature: Feature, name: string): unknown {
  if (!feature.properties)
    throw new Error(`Expected rendered feature ${feature.id} to have properties.`);
  return feature.properties[name];
}

describe('buildFeatures service lines', () => {
  it('centers a Network bundle without letting input order swap its services', () => {
    const road = aRoad('trunk', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const red = aService('red', [aPattern('red-pattern', [road], [road.id])]);
    const blue = aService('blue', [aPattern('blue-pattern', [road], [road.id])], {
      color: '#2e86e4',
    });
    const features = buildFeatures(
      aSystem({ ways: [road], services: [red, blue] }),
      null,
      [],
      NETWORK_VIEW,
    );
    const offsets = new Map(
      features.services.features
        .filter((feature) => featureProperty(feature, 'hitTarget') !== true)
        .map((feature) => [
          String(featureProperty(feature, 'serviceId')),
          featureProperty(feature, 'offset'),
        ]),
    );

    expect(offsets).toEqual(
      new Map([
        ['red', -2.5],
        ['blue', 2.5],
      ]),
    );
  });

  it('contracts a shared Network bundle into centered branch services', () => {
    const trunk = aRoad('trunk', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const redBranch = aRoad('red-branch', [
      [-115.16, 36.14],
      [-115.14, 36.16],
    ]);
    const blueBranch = aRoad('blue-branch', [
      [-115.16, 36.14],
      [-115.14, 36.12],
    ]);
    const ways = [trunk, redBranch, blueBranch];
    const red = aService('red', [aPattern('red-pattern', ways, [trunk.id, redBranch.id])]);
    const blue = aService('blue', [aPattern('blue-pattern', ways, [trunk.id, blueBranch.id])], {
      color: '#2e86e4',
    });
    const features = buildFeatures(
      aSystem({ ways, services: [red, blue] }),
      null,
      [],
      NETWORK_VIEW,
    );
    const offsetsFor = (serviceId: string, wayId: string): unknown[] =>
      features.services.features
        .filter(
          (candidate) =>
            featureProperty(candidate, 'hitTarget') !== true &&
            featureProperty(candidate, 'serviceId') === serviceId &&
            featureProperty(candidate, 'wayId') === wayId,
        )
        .map((feature) => featureProperty(feature, 'offset'));

    expect(offsetsFor('red', trunk.id)).toContain(-2.5);
    expect(offsetsFor('blue', trunk.id)).toContain(2.5);
    expect(offsetsFor('red', redBranch.id)).toContain(0);
    expect(offsetsFor('blue', blueBranch.id)).toContain(0);
  });

  it('meets a branch at one shared bundle offset before it contracts', () => {
    const trunk = aRoad('trunk', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const branch = aRoad('branch', [
      [-115.16, 36.14],
      [-115.14, 36.16],
    ]);
    const ways = [trunk, branch];
    const red = aService('red', [aPattern('red-pattern', ways, [trunk.id, branch.id])]);
    const blue = aService('blue', [aPattern('blue-pattern', ways, [trunk.id])], {
      color: '#2e86e4',
    });
    const features = buildFeatures(
      aSystem({ ways, services: [red, blue] }),
      null,
      [],
      NETWORK_VIEW,
    );
    const branchPoint = trunk.points[trunk.points.length - 1];
    const atBranchPoint = (wayId: string) =>
      features.services.features.filter((feature) => {
        if (
          featureProperty(feature, 'hitTarget') === true ||
          featureProperty(feature, 'serviceId') !== 'red' ||
          featureProperty(feature, 'wayId') !== wayId
        ) {
          return false;
        }
        const coordinates = feature.geometry.coordinates;
        return (
          JSON.stringify(coordinates[0]) === JSON.stringify(branchPoint) ||
          JSON.stringify(coordinates[coordinates.length - 1]) === JSON.stringify(branchPoint)
        );
      });

    const trunkOffsets = atBranchPoint(trunk.id).map((feature) =>
      featureProperty(feature, 'offset'),
    );
    const branchOffsets = atBranchPoint(branch.id).map((feature) =>
      featureProperty(feature, 'offset'),
    );

    expect(trunkOffsets).toEqual([-1.25]);
    expect(branchOffsets).toEqual([-1.25]);
  });

  it('keeps a bundled service split into stable corridor-owned paint fragments', () => {
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
      (feature) =>
        featureProperty(feature, 'serviceId') === 'svc1' &&
        featureProperty(feature, 'hitTarget') !== true,
    );
    const svc2Features = fc.services.features.filter(
      (feature) =>
        featureProperty(feature, 'serviceId') === 'svc2' &&
        featureProperty(feature, 'hitTarget') !== true,
    );

    expect(svc1Features).toHaveLength(2);
    expect(svc1Features.map((feature) => featureProperty(feature, 'wayId'))).toEqual([
      'wayA',
      'wayB',
    ]);
    expect(new Set(svc1Features.map((feature) => feature.id)).size).toBe(2);
    expect(svc1Features[0].geometry.coordinates).toEqual(wayA.points);
    expect(svc1Features[1].geometry.coordinates).toEqual(wayB.points);
    // The fixture helper maps its test-only colour shorthand into public Lines.
    // Rendering must read that public ownership, never stale Service metadata.
    expect(svc2Features.map((feature) => featureProperty(feature, 'color'))).toEqual([
      '#2e86e4',
      '#2e86e4',
    ]);
  });

  it('keeps repeated-way hit metadata with one paint fragment per corridor', () => {
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
      (feature) =>
        featureProperty(feature, 'serviceId') === 'svc' &&
        featureProperty(feature, 'hitTarget') !== true,
    );
    const hits = features.filter(
      (feature) =>
        featureProperty(feature, 'serviceId') === 'svc' &&
        featureProperty(feature, 'hitTarget') === true,
    );

    expect(painted).toHaveLength(2);
    expect(painted.map((feature) => featureProperty(feature, 'wayId'))).toEqual(['loop', 'bend']);
    expect(painted.every((feature) => featureProperty(feature, 'offset') !== 0)).toBe(true);
    expect(hits.map((feature) => featureProperty(feature, 'legIndex')).sort()).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    expect(hits.every((feature) => featureProperty(feature, 'patternId') === 'svc')).toBe(true);
    expect(
      hits.every(
        (feature) => featureProperty(feature, 'offset') === featureProperty(painted[0], 'offset'),
      ),
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
      id: 'line',
      sections: oneSection([wholeLeg('trunk'), wholeLeg('north')]),
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

  it('service termini identify both ends of the selected path', () => {
    const features = buildFeatures(
      system,
      { kind: 'service', id: service.id },
      [],
      NETWORK_VIEW,
      null,
      null,
      { activePatternId: 'line' } as never,
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
      termini.features.map((feature) => ({
        ...feature.properties,
        at: feature.geometry.coordinates,
      })),
    ).toEqual([
      {
        serviceId: 'line',
        patternId: 'line',
        side: 'start',
        modeId: 'bus',
        interactive: true,
        at: [-115.2, 36.1],
      },
      {
        serviceId: 'line',
        patternId: 'line',
        side: 'end',
        modeId: 'bus',
        interactive: true,
        at: [-115.18, 36.11],
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
        activePatternId: 'line',
        armedTerminus: {
          serviceId: 'line',
          patternId: 'line',
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
        patternId: 'line',
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
