import { describe, expect, it } from 'vitest';
import { MODE_ORDER, mode } from './catalog';
import { defaultProfileFor } from './profile';
import { patternPositionAt } from './serviceEdits';
import { planTerminusGesture } from './serviceGestures';
import { aPattern, aRoad, aService, aStation, aSystem } from '../testing/fixtures';
import type { Way } from './system';

const A: [number, number] = [-115.2, 36.1];
const B: [number, number] = [-115.19, 36.1];
const C: [number, number] = [-115.18, 36.1];
const D: [number, number] = [-115.19, 36.11];

function rail(id: string, points: [number, number][], typeId = 'lightRail'): Way {
  return {
    id,
    typeId,
    points,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor(typeId),
  };
}

describe('service terminus gesture planning', () => {
  it.each(
    MODE_ORDER.flatMap((modeId) => mode(modeId).wayTypeIds.map((typeId) => ({ modeId, typeId }))),
  )('routes a legal $modeId terminus extension on $typeId', ({ modeId, typeId }) => {
    const first = rail('first', [A, B], typeId);
    const second = rail('second', [B, C], typeId);
    const pattern = aPattern('branch', [first], ['first']);
    const system = aSystem({
      ways: [first, second],
      services: [aService('service', [pattern], { modeId })],
      nodes: [
        {
          id: 'joint',
          coord: B,
          refs: [
            { wayId: 'first', pointIndex: 1 },
            { wayId: 'second', pointIndex: 0 },
          ],
        },
      ],
    });

    const result = planTerminusGesture(
      system,
      { serviceId: 'service', patternId: 'branch', side: 'end', purpose: 'extend' },
      { kind: 'corridor', wayId: 'second', coord: C },
    );

    expect(result.kind).toBe('extend');
    expect(result.spans.some((span) => span.wayId === 'second')).toBe(true);
  });

  it.each(['start', 'end'] as const)(
    'plans a legal %s extension without changing stored objects',
    (side) => {
      const trunk = aRoad('trunk', [A, B]);
      const extension = aRoad('extension', side === 'end' ? [B, C] : [C, A]);
      const pattern = aPattern('branch', [trunk], ['trunk']);
      const service = aService('bus', [pattern]);
      const station = aStation('station', B, { wayId: 'trunk', t: 1 });
      const joint = side === 'end' ? B : A;
      const system = aSystem({
        ways: [trunk, extension],
        services: [service],
        stations: [station],
        nodes: [
          {
            id: 'joint',
            coord: joint,
            refs: [
              { wayId: 'trunk', pointIndex: side === 'end' ? 1 : 0 },
              { wayId: 'extension', pointIndex: side === 'end' ? 0 : 1 },
            ],
          },
        ],
      });

      const result = planTerminusGesture(
        system,
        { serviceId: service.id, patternId: pattern.id, side, purpose: 'extend' },
        { kind: 'corridor', wayId: extension.id, coord: C },
      );

      expect(result.kind).toBe('extend');
      expect(result.system).toBe(system);
      expect(result.system.ways[0]).toBe(trunk);
      expect(result.system.stations[0]).toBe(station);
      expect(result.spans.some((span) => span.wayId === extension.id)).toBe(true);
    },
  );

  it('plans an exact same-branch interior drop as a directional loop', () => {
    const ways = [
      aRoad('a-b', [A, B]),
      aRoad('b-c', [B, C]),
      aRoad('c-d', [C, D]),
      aRoad('d-b', [D, B]),
    ];
    const pattern = aPattern('branch', ways, ['a-b', 'b-c']);
    const system = aSystem({
      ways,
      services: [aService('bus', [pattern])],
      nodes: [
        {
          id: 'b',
          coord: B,
          refs: [
            { wayId: 'a-b', pointIndex: 1 },
            { wayId: 'b-c', pointIndex: 0 },
            { wayId: 'd-b', pointIndex: 1 },
          ],
        },
        {
          id: 'c',
          coord: C,
          refs: [
            { wayId: 'b-c', pointIndex: 1 },
            { wayId: 'c-d', pointIndex: 0 },
          ],
        },
        {
          id: 'd',
          coord: D,
          refs: [
            { wayId: 'c-d', pointIndex: 1 },
            { wayId: 'd-b', pointIndex: 0 },
          ],
        },
      ],
    });
    const target = patternPositionAt(ways, pattern, 'outbound', 0, 1)!;

    const result = planTerminusGesture(
      system,
      { serviceId: 'bus', patternId: 'branch', side: 'end', purpose: 'extend' },
      { kind: 'service-position', serviceId: 'bus', position: target },
    );

    expect(result.kind).toBe('loop');
    expect(result.spans.map((span) => span.wayId)).toEqual(['c-d', 'd-b']);
  });

  it('refuses a different mode without planning topology or mutation', () => {
    const road = aRoad('road', [A, B]);
    const track = rail('track', [B, C], 'heavyRail');
    const busPattern = aPattern('bus-pattern', [road], ['road']);
    const railPattern = aPattern('rail-pattern', [track], ['track']);
    const system = aSystem({
      ways: [road, track],
      services: [
        aService('bus', [busPattern]),
        aService('rail', [railPattern], { modeId: 'subway' }),
      ],
    });
    const target = patternPositionAt([road, track], railPattern, 'outbound', 0, 0)!;

    const result = planTerminusGesture(
      system,
      { serviceId: 'bus', patternId: busPattern.id, side: 'end', purpose: 'extend' },
      { kind: 'service-position', serviceId: 'rail', position: target },
    );

    expect(result).toEqual({
      kind: 'refuse',
      reason: 'different-mode',
      baseSystem: system,
      system,
      spans: [],
    });
  });

  it('refuses a same-mode target whose corridor type is not allowed by that mode', () => {
    const road = aRoad('road', [A, B]);
    const track = rail('track', [B, C]);
    const busPattern = aPattern('bus-pattern', [road], ['road']);
    const impossibleTarget = aPattern('target-pattern', [track], ['track']);
    const system = aSystem({
      ways: [road, track],
      services: [aService('bus', [busPattern]), aService('target', [impossibleTarget])],
    });
    const target = patternPositionAt([road, track], impossibleTarget, 'outbound', 0, 0)!;

    const result = planTerminusGesture(
      system,
      { serviceId: 'bus', patternId: busPattern.id, side: 'end', purpose: 'extend' },
      { kind: 'service-position', serviceId: 'target', position: target },
    );

    expect(result).toEqual({
      kind: 'refuse',
      reason: 'incompatible-corridor',
      baseSystem: system,
      system,
      spans: [],
    });
  });

  it('plans a light-rail connection across dedicated track and road', () => {
    const track = rail('track', [A, B]);
    const road = aRoad('road', [B, C]);
    const trackPattern = aPattern('track-pattern', [track], ['track']);
    const roadPattern = aPattern('road-pattern', [road], ['road']);
    const system = aSystem({
      ways: [track, road],
      services: [
        aService('dragged', [trackPattern], { modeId: 'lightRail' }),
        aService('target', [roadPattern], { modeId: 'lightRail' }),
      ],
    });
    const target = patternPositionAt([track, road], roadPattern, 'outbound', 0, 0)!;

    const result = planTerminusGesture(
      system,
      {
        serviceId: 'dragged',
        patternId: trackPattern.id,
        side: 'end',
        purpose: 'extend',
      },
      { kind: 'service-position', serviceId: 'target', position: target },
    );

    expect(result.kind).toBe('connect');
    expect(result.system.nodes).toHaveLength(1);
    expect(result.system.nodes[0].refs.map((ref) => ref.wayId).sort()).toEqual(['road', 'track']);
  });

  it.each([
    {
      name: 'a physical corridor',
      target: { kind: 'corridor' as const, wayId: 'return', coord: D },
    },
    {
      name: 'another service',
      target: null,
    },
  ])('refuses an armed return dropped on $name before preview', ({ target }) => {
    const trunk = aRoad('trunk', [A, B]);
    const returnWay = aRoad('return', [B, D]);
    const otherPattern = aPattern('other-pattern', [returnWay], ['return']);
    const pattern = aPattern('branch', [trunk], ['trunk']);
    const system = aSystem({
      ways: [trunk, returnWay],
      services: [aService('service', [pattern]), aService('other', [otherPattern])],
      nodes: [
        {
          id: 'joint',
          coord: B,
          refs: [
            { wayId: 'trunk', pointIndex: 1 },
            { wayId: 'return', pointIndex: 0 },
          ],
        },
      ],
    });
    const otherTarget = patternPositionAt(system.ways, otherPattern, 'outbound', 0, 0)!;

    const result = planTerminusGesture(
      system,
      { serviceId: 'service', patternId: 'branch', side: 'end', purpose: 'return' },
      target ?? {
        kind: 'service-position',
        serviceId: 'other',
        position: otherTarget,
      },
    );

    expect(result.kind).toBe('refuse');
    expect(result.spans).toEqual([]);
  });
});
