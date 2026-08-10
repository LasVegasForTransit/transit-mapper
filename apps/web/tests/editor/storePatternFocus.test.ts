import { describe, expect, it } from 'vitest';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { createEditorStore } from '../../src/editor/store';

describe('active service path focus', () => {
  it('selecting a service focuses its singular path transiently', () => {
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

        path: { id: 'line', sections: oneSection([wholeLeg('trunk')]) },
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
    ).toBe('line');
  });

  it('clears the active path id when its service is deleted', () => {
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

        path: { id: 'line', sections: oneSection([wholeLeg('trunk')]) },
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'line' });
    store.getState().setActivePattern('line');

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

        path: { id: 'line', sections: oneSection([wholeLeg('trunk')]) },
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'line' });
    const position = patternPositionAt(system.ways, system.services[0].path, 'outbound', 0, 0.5)!;

    const spawned = store.getState().divideServiceAt('line', position)!;
    const state = store.getState();
    expect(state.selection).toEqual({ kind: 'service', id: spawned });
    expect(state.system.services.find((service) => service.id === spawned)?.path.id).toBe(
      state.activePatternId,
    );
  });
});
