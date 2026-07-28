// Regression test for a line that reads as one continuous route but rendered
// as one disconnected offset copy per way at a bend — see mergeServiceLines.ts
// for the mechanism (line-offset is mitered per-feature, not across a way
// boundary).

import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../model/catalog';
import { wholeLeg, wholeLegs, oneSection } from '../model/geo';
import { wayById } from '../model/geo/wayPath';
import { aRoad, aService, aSystem } from '../testing/fixtures';
import type { Pattern, Service } from '../model/system';
import { buildFeatures, type ViewOptions } from './buildFeatures';

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
    const svc1Features = fc.services.features.filter((f) => f.properties?.serviceId === 'svc1');

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
    expect(hits.map((feature) => feature.properties?.legIndex).sort()).toEqual([0, 2]);
    expect(hits.every((feature) => feature.properties?.patternId === 'repeat')).toBe(true);
    expect(
      hits.every((feature) => feature.properties?.offset === painted[0].properties?.offset),
    ).toBe(true);
  });
});
