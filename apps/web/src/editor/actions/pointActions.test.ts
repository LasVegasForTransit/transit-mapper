import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { oneSection, patternRunLegs, wholeLeg } from '@transitmapper/core/model/geo';
import { servicePointActionProvider } from './pointActions';
import { createEditorStore } from '../store';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';

describe('service point actions', () => {
  it('requires the interaction-resolved occurrence position', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [],
      },
    ];

    expect(
      servicePointActionProvider(store)({
        system,
        refs: [{ kind: 'service', id: 'line' }],
        at: [-115.2, 36.1],
        serviceHit: { serviceId: 'line', patternId: 'missing' },
      }),
    ).toEqual([]);
  });
  it('ends a repeated corridor at the exact displayed occurrence and keeps the longer half', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'out',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        points: [
          [-115.2, 36.1],
          [-115.19, 36.1],
        ],
      },
      {
        id: 'return',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        points: [
          [-115.19, 36.1],
          [-115.18, 36.1],
        ],
      },
    ];
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'loop',
            sections: oneSection([
              wholeLeg('out'),
              wholeLeg('return'),
              wholeLeg('out', 'againstPoints'),
            ]),
          },
        ],
      },
    ];
    store.getState().setSystem(system);

    const actions = servicePointActionProvider(store)({
      system,
      refs: [{ kind: 'service', id: 'line' }],
      at: [-115.1875, 36.1],
      serviceHit: {
        serviceId: 'line',
        patternId: 'loop',
        run: 'outbound',
        legIndex: 1,
        position: patternPositionAt(
          system.ways,
          system.services[0].patterns[0],
          'outbound',
          1,
          0.25,
        )!,
      },
    });
    actions.find((action) => action.id === 'service.endHere')!.run();

    expect(
      patternRunLegs(store.getState().system.services[0].patterns[0], 'outbound').map(
        ({ leg }) => leg.wayId,
      ),
    ).toEqual(['return', 'out']);
  });

  it('uses the rendered second occurrence when a line rides the same way twice', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'loop',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        points: [
          [-115.2, 36.1],
          [-115.19, 36.1],
        ],
      },
    ];
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'loop',
            sections: oneSection([wholeLeg('loop'), wholeLeg('loop', 'againstPoints')]),
          },
        ],
      },
    ];
    store.getState().setSystem(system);

    const actions = servicePointActionProvider(store)({
      system,
      refs: [{ kind: 'service', id: 'line' }],
      at: [-115.195, 36.1],
      serviceHit: {
        serviceId: 'line',
        patternId: 'loop',
        run: 'outbound',
        legIndex: 1,
        position: patternPositionAt(
          system.ways,
          system.services[0].patterns[0],
          'outbound',
          1,
          0.5,
        )!,
      },
    });
    actions.find((action) => action.id === 'service.endHere')!.run();

    const legs = patternRunLegs(store.getState().system.services[0].patterns[0], 'outbound');
    expect(legs).toHaveLength(2);
    expect(legs[0].leg).toEqual(wholeLeg('loop'));
    expect(legs[1].leg.extent).toEqual({ kind: 'stretch', fromT: 0.5, toT: 1 });
  });

  it('ends a couplet from the rendered outbound occurrence', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      ['trunk', -115.2, -115.19],
      ['outbound', -115.19, -115.18],
      ['inbound', -115.18, -115.19],
      ['north', -115.18, -115.17],
    ].map(([id, from, to]) => ({
      id: id as string,
      typeId: 'road' as const,
      geometry: 'straight' as const,
      grade: 'atGrade' as const,
      profile: defaultProfileFor('road'),
      points: [
        [from as number, 36.1],
        [to as number, 36.1],
      ] as [number, number][],
    }));
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'couplet',
            sections: [
              { kind: 'shared', legs: [wholeLeg('trunk')] },
              { kind: 'split', outbound: [wholeLeg('outbound')], inbound: [wholeLeg('inbound')] },
              { kind: 'shared', legs: [wholeLeg('north')] },
            ],
          },
        ],
      },
    ];
    store.getState().setSystem(system);

    const actions = servicePointActionProvider(store)({
      system,
      refs: [{ kind: 'service', id: 'line' }],
      at: [-115.182, 36.1],
      serviceHit: {
        serviceId: 'line',
        patternId: 'couplet',
        run: 'outbound',
        legIndex: 1,
        position: patternPositionAt(
          system.ways,
          system.services[0].patterns[0],
          'outbound',
          1,
          0.8,
        )!,
      },
    });
    actions.find((action) => action.id === 'service.endHere')!.run();

    const sections = store.getState().system.services[0].patterns[0].sections;
    expect(sections).toHaveLength(2);
    expect(sections[1].kind).toBe('split');
  });
});
