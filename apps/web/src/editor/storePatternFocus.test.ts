import { describe, expect, it } from 'vitest';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { createEditorStore } from './store';

describe('active service pattern focus', () => {
  it('selecting a branched service focuses its first branch transiently', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'trunk',
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
          { id: 'first', sections: oneSection([wholeLeg('trunk')]) },
          { id: 'second', sections: oneSection([wholeLeg('trunk')]) },
        ],
      },
    ];
    store.getState().setSystem(system);

    store.getState().select({ kind: 'service', id: 'line' });

    expect(
      (
        store.getState() as ReturnType<typeof store.getState> & {
          activePatternId?: string | null;
        }
      ).activePatternId,
    ).toBe('first');
  });

  it('keeps the active id valid when its pattern or service is deleted', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'trunk',
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
          { id: 'first', sections: oneSection([wholeLeg('trunk')]) },
          { id: 'second', sections: oneSection([wholeLeg('trunk')]) },
        ],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'line' });
    store.getState().setActivePattern('second');

    store.getState().deletePattern('line', 'second');
    expect(store.getState().activePatternId).toBe('first');

    store.getState().deleteService('line');
    expect(store.getState().activePatternId).toBeNull();
    expect(store.getState().selection).toBeNull();
  });

  it('focuses the spawned service pattern after dividing a selected branch', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'trunk',
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
        patterns: [{ id: 'branch', sections: oneSection([wholeLeg('trunk')]) }],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'line' });
    const position = patternPositionAt(
      system.ways,
      system.services[0].patterns[0],
      'outbound',
      0,
      0.5,
    )!;

    const spawned = store.getState().divideServiceAt('line', position)!;
    const state = store.getState();
    expect(state.selection).toEqual({ kind: 'service', id: spawned });
    expect(state.system.services.find((service) => service.id === spawned)?.patterns[0].id).toBe(
      state.activePatternId,
    );
  });
});
