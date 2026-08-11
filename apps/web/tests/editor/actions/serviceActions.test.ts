import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../../src/editor/store';
import { createSelectionActions } from '../../../src/editor/actions';
import {
  JOIN_THROUGH_SERVICE_LABEL,
  serviceActionProvider,
} from '../../../src/editor/actions/serviceActions';

describe('terminus service actions', () => {
  it('groups all Services from two selected public Lines without changing their modes', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.lines = [
      { id: 'red', name: 'Red', color: '#f00', serviceIds: ['red-bus'] },
      {
        id: 'blue',
        name: 'Blue',
        color: '#00f',
        serviceIds: ['blue-rail', 'blue-bus'],
      },
    ];
    system.services = [
      { id: 'red-bus', modeId: 'bus', path: { id: 'red-bus', sections: [] } },
      { id: 'blue-rail', modeId: 'subway', path: { id: 'blue-rail', sections: [] } },
      { id: 'blue-bus', modeId: 'bus', path: { id: 'blue-bus', sections: [] } },
    ];
    store.commands.document.setSystem(system);

    const action = serviceActionProvider(store)({
      system,
      refs: [
        { kind: 'line', id: 'red' },
        { kind: 'line', id: 'blue' },
      ],
    }).find((candidate) => candidate.id === 'line.groupServices');

    expect(action?.label).toBe('Group under one line');
    action?.run();
    expect(store.getState().system.lines).toEqual([
      {
        id: 'red',
        name: 'Red',
        color: '#f00',
        serviceIds: ['red-bus', 'blue-rail', 'blue-bus'],
      },
    ]);
    expect(store.getState().system.services.map((service) => service.modeId)).toEqual([
      'bus',
      'subway',
      'bus',
    ]);

    store.commands.history.undo();
    expect(store.getState().system).toBe(system);
  });

  it('uses the standard through-service connection label', () => {
    expect(JOIN_THROUGH_SERVICE_LABEL).toBe('Join into a through-service');
  });

  it('clears an armed terminus when its model reference can no longer exist', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',

        path: { id: 'branch', sections: oneSection([wholeLeg('way')]) },
      },
    ];
    const arm = () =>
      store.commands.selection.armTerminus({
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

    store.commands.document.setSystem(system);
    arm();
    store.commands.services.deleteService('line');
    expect(store.getState().armedTerminus).toBeNull();

    store.commands.document.setSystem(system);
    arm();
    store.commands.document.newSystem();
    expect(store.getState().armedTerminus).toBeNull();

    store.commands.document.setSystem(system);
    arm();
    store.commands.document.setSystem(createEmptySystem());
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

        path: { id: 'branch', sections: oneSection([wholeLeg('way')]) },
      },
    ];
    store.commands.document.setSystem(system);

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

  it('offers conversion only from an exact terminus, not a whole-line selection', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',

        path: { id: 'branch', sections: oneSection([wholeLeg('way')]) },
      },
    ];

    const actions = serviceActionProvider(store)({
      system,
      refs: [{ kind: 'service', id: 'line' }],
    });

    expect(actions).toEqual([]);
  });

  it.each(['start', 'end'] as const)('arms the %s end without mutating the system', (side) => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.services = [
      {
        id: 'line',
        name: 'Line',
        modeId: 'bus',

        path: { id: 'branch', sections: oneSection([wholeLeg('way')]) },
      },
    ];
    store.commands.document.setSystem(system);
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

    expect(action.label).toBe('Add a return trip from here');
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
