import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../store';
import { createSelectionActions } from '.';
import { serviceActionProvider } from './serviceActions';

describe('terminus service actions', () => {
  it('clears an armed terminus when its model reference can no longer exist', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          { id: 'branch', sections: oneSection([wholeLeg('way')]) },
          { id: 'other', sections: oneSection([wholeLeg('way')]) },
        ],
      },
    ];
    const arm = () =>
      store.getState().armTerminus({
        serviceId: 'line',
        patternId: 'branch',
        side: 'end',
        position: {
          patternId: 'branch',
          run: 'outbound',
          legIndex: 0,
          wayId: 'way',
          t: 1,
          distanceMeters: 100,
        },
      });

    store.getState().setSystem(system);
    arm();
    store.getState().deletePattern('line', 'branch');
    expect(store.getState().armedTerminus).toBeNull();

    store.getState().setSystem(system);
    arm();
    store.getState().deleteService('line');
    expect(store.getState().armedTerminus).toBeNull();

    store.getState().setSystem(system);
    arm();
    store.getState().newSystem();
    expect(store.getState().armedTerminus).toBeNull();

    store.getState().setSystem(system);
    arm();
    store.getState().setSystem(createEmptySystem());
    expect(store.getState().armedTerminus).toBeNull();
  });

  it('offers only the terminus conversion through the real action registry', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: oneSection([wholeLeg('way')]) }],
      },
    ];
    store.getState().setSystem(system);

    expect(
      createSelectionActions(store)
        .actionsFor({
          system,
          refs: [{ kind: 'service', id: 'line' }],
          serviceHit: {
            serviceId: 'line',
            patternId: 'branch',
            terminusSide: 'end',
            position: {
              patternId: 'branch',
              run: 'outbound',
              legIndex: 0,
              wayId: 'way',
              t: 1,
              distanceMeters: 100,
            },
          },
        })
        .map((action) => action.id),
    ).toEqual(['service.convertTerminus']);
  });

  it.each(['start', 'end'] as const)('arms the %s end without mutating the system', (side) => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: oneSection([wholeLeg('way')]) }],
      },
    ];
    store.getState().setSystem(system);
    const before = store.getState().system;
    const action = serviceActionProvider(store)({
      system,
      refs: [{ kind: 'service', id: 'line' }],
      serviceHit: {
        serviceId: 'line',
        patternId: 'branch',
        terminusSide: side,
        position: {
          patternId: 'branch',
          run: 'outbound',
          legIndex: side === 'start' ? 0 : 1,
          wayId: 'way',
          t: side === 'start' ? 0 : 1,
          distanceMeters: side === 'start' ? 0 : 100,
        },
      },
    })[0];

    expect(action.label).toBe('Convert end to two one-way paths');
    action.run();
    expect(store.getState().system).toBe(before);
    expect(store.getState().armedTerminus).toMatchObject({
      serviceId: 'line',
      patternId: 'branch',
      side,
      position: { t: side === 'start' ? 0 : 1 },
    });
    expect(store.getState().routeDraft).toBeNull();
  });
});
