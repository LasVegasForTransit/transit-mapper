import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { patternLegs, patternRunLegs } from '@transitmapper/core/model/geo';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { planTerminusGesture } from '@transitmapper/core/model/serviceGestures';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEditorStore } from '../../src/editor/store';
const A: [number, number] = [-115.2, 36.1];
const B: [number, number] = [-115.19, 36.1];
const C: [number, number] = [-115.18, 36.1];
const D: [number, number] = [-115.19, 36.11];

describe('network gesture store transactions', () => {
  it('commits a terminus extension as one undo step without moving infrastructure or stops', () => {
    const trunk = aRoad('trunk', [A, B]);
    const extension = aRoad('extension', [B, C]);
    const pattern = aPattern('branch', [trunk], ['trunk']);
    const sibling = aPattern('sibling', [trunk], ['trunk']);
    const service = aService('bus', [pattern]);
    const siblingService = aService('bus-sibling', [sibling]);
    const stop = aStop('stop', B, { wayId: 'trunk', t: 1 });
    const original = aSystem({
      ways: [trunk, extension],
      services: [service, siblingService],
      lines: [
        {
          id: 'bus-line',
          name: 'Bus line',
          color: '#e4572e',
          serviceIds: [service.id, siblingService.id],
        },
      ],
      stops: [stop],
      nodes: [
        {
          id: 'joint',
          coord: B,
          refs: [
            { wayId: 'trunk', pointIndex: 1 },
            { wayId: 'extension', pointIndex: 0 },
          ],
        },
      ],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(original);
    const source = {
      serviceId: service.id,
      patternId: service.id,
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = { kind: 'corridor' as const, wayId: extension.id, coord: C };
    const plan = planTerminusGesture(original, source, target);

    expect(store.commands.services.commitTerminusGesture(source, target, plan)).toBe(true);

    const committed = store.getState().system;
    expect(committed.ways).toBe(original.ways);
    expect(committed.nodes).toBe(original.nodes);
    expect(committed.stops).toBe(original.stops);
    expect(committed.services[0].id).toBe(service.id);
    expect(committed.services[0].path.sections).toHaveLength(2);
    expect(committed.services.find((candidate) => candidate.id === siblingService.id)?.path).toBe(
      siblingService.path,
    );

    store.commands.history.undo();
    expect(store.getState().system).toBe(original);
  });

  it('clears an armed return after a refused drop without changing the system', () => {
    const road = aRoad('road', [A, B]);
    const pattern = aPattern('branch', [road], ['road']);
    const original = aSystem({ ways: [road], services: [aService('bus', [pattern])] });
    const position = patternPositionAt([road], original.services[0].path, 'outbound', 0, 1);
    if (!position) throw new Error('Expected the service terminus position');
    const store = createEditorStore();
    store.commands.document.setSystem(original);
    store.commands.selection.armTerminus({
      serviceId: 'bus',
      patternId: 'bus',
      side: 'end',
      position,
    });
    const source = {
      serviceId: 'bus',
      patternId: 'bus',
      side: 'end' as const,
      purpose: 'return' as const,
    };
    const target = { kind: 'corridor' as const, wayId: 'missing', coord: C };
    const plan = planTerminusGesture(original, source, target);

    expect(store.commands.services.commitTerminusGesture(source, target, plan)).toBe(false);
    expect(store.getState().system).toBe(original);
    expect(store.getState().armedTerminus).toBeNull();
    expect(store.getState().canUndo).toBe(false);
  });

  it('commits an armed return reconnect as one split-path undo step', () => {
    const ways = [
      aRoad('a-b', [A, B]),
      aRoad('b-c', [B, C]),
      aRoad('c-d', [C, D]),
      aRoad('d-b', [D, B]),
    ];
    const pattern = aPattern('branch', ways, ['a-b', 'b-c']);
    const original = aSystem({
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
    const targetPosition = patternPositionAt(ways, original.services[0].path, 'outbound', 0, 1);
    if (!targetPosition) throw new Error('Expected the target service position');
    const source = {
      serviceId: 'bus',
      patternId: 'bus',
      side: 'end' as const,
      purpose: 'return' as const,
    };
    const target = {
      kind: 'service-position' as const,
      serviceId: 'bus',
      position: targetPosition,
    };
    const plan = planTerminusGesture(original, source, target);
    const store = createEditorStore();
    store.commands.document.setSystem(original);

    expect(store.commands.services.commitTerminusGesture(source, target, plan)).toBe(true);
    expect(store.getState().system.services[0].path.sections).toMatchObject([
      { kind: 'shared' },
      { kind: 'split' },
    ]);
    expect(store.getState().system.ways).toBe(original.ways);

    store.commands.history.undo();
    expect(store.getState().system).toBe(original);
  });

  it('keeps the dragged service identity and schedule when choosing a through-service', () => {
    const first = aRoad('first', [A, B]);
    const second = aRoad('second', [B, C]);
    const draggedPattern = aPattern('dragged-pattern', [first], ['first']);
    const targetPattern = aPattern('target-pattern', [second], ['second']);
    const dragged = aService('dragged', [draggedPattern], {
      name: 'Keep me',
      color: '#123456',
      frequencyMinutes: 7,
      spanStart: '05:00',
      spanEnd: '01:00',
    });
    const targetService = aService('target', [targetPattern], { color: '#abcdef' });
    const original = aSystem({ ways: [first, second], services: [dragged, targetService] });
    const targetPosition = patternPositionAt(
      [first, second],
      targetService.path,
      'outbound',
      0,
      0,
    )!;
    const source = {
      serviceId: dragged.id,
      patternId: dragged.id,
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = {
      kind: 'service-position' as const,
      serviceId: targetService.id,
      position: targetPosition,
      terminus: { patternId: targetService.id, side: 'start' as const },
    };
    const plan = planTerminusGesture(original, source, target);
    const store = createEditorStore();
    store.commands.document.setSystem(original);

    expect(store.commands.services.commitTerminusGesture(source, target, plan)).toBe(false);
    expect(store.getState().system).toBe(original);
    expect(store.commands.services.commitTerminusGesture(source, target, plan, 'through')).toBe(
      true,
    );

    expect(store.getState().system.services).toHaveLength(1);
    expect(store.getState().system.services[0]).toMatchObject({
      id: dragged.id,
      name: 'Keep me',
      color: '#123456',
      frequencyMinutes: 7,
      spanStart: '05:00',
      spanEnd: '01:00',
    });
    store.commands.history.undo();
    expect(store.getState().system).toBe(original);
  });

  it('through-routes the exact chosen branches when another terminus pair is nearer', () => {
    const desiredKeep = aRoad('desired-keep', [A, B]);
    const connector = aRoad('connector', [B, [-115.1895, 36.1]]);
    const desiredOther = aRoad('desired-other', [[-115.1895, 36.1], C]);
    const alternateKeep = aRoad('alternate-keep', [
      [-115.3, 36.2],
      [-115.29, 36.2],
    ]);
    const alternateOther = aRoad('alternate-other', [
      [-115.29, 36.2],
      [-115.28, 36.2],
    ]);
    const desiredA = aPattern('desired-a', [desiredKeep], ['desired-keep']);
    const desiredB = aPattern('desired-b', [desiredOther], ['desired-other']);
    const original = aSystem({
      ways: [desiredKeep, connector, desiredOther, alternateKeep, alternateOther],
      services: [
        aService('alternate-a', [aPattern('alternate-a', [alternateKeep], ['alternate-keep'])]),
        aService('desired-a', [desiredA]),
        aService('alternate-b', [aPattern('alternate-b', [alternateOther], ['alternate-other'])]),
        aService('desired-b', [desiredB]),
      ],
      nodes: [
        {
          id: 'west',
          coord: B,
          refs: [
            { wayId: 'desired-keep', pointIndex: 1 },
            { wayId: 'connector', pointIndex: 0 },
          ],
        },
        {
          id: 'east',
          coord: [-115.1895, 36.1],
          refs: [
            { wayId: 'connector', pointIndex: 1 },
            { wayId: 'desired-other', pointIndex: 0 },
          ],
        },
      ],
    });
    const source = {
      serviceId: 'desired-a',
      patternId: 'desired-a',
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = {
      kind: 'service-position' as const,
      serviceId: 'desired-b',
      position: patternPositionAt(
        original.ways,
        original.services.find((service) => service.id === 'desired-b')!.path,
        'outbound',
        0,
        0,
      )!,
      terminus: { patternId: 'desired-b', side: 'start' as const },
    };
    const plan = planTerminusGesture(original, source, target);
    const store = createEditorStore();
    store.commands.document.setSystem(original);

    expect(store.commands.services.commitTerminusGesture(source, target, plan, 'through')).toBe(
      true,
    );
    const joined = store
      .getState()
      .system.services.find((service) => service.id === 'desired-a')!.path;
    expect(patternLegs(joined).map((leg) => leg.wayId)).toEqual([
      'desired-keep',
      'connector',
      'desired-other',
    ]);
  });

  it('keeps automatic crossings between different corridor types topologically separate', () => {
    const road = aRoad('road', [
      [-115.2, 36.09],
      [-115.2, 36.11],
    ]);
    const track = aRoad(
      'track',
      [
        [-115.21, 36.1],
        [-115.19, 36.1],
      ],
      {
        typeId: 'lightRail',
        profile: defaultProfileFor('lightRail'),
      },
    );
    const original = aSystem({ ways: [road, track] });
    const store = createEditorStore();
    store.commands.document.setSystem(original);

    store.commands.network.formCrossingJunctions('road');

    expect(store.getState().system.nodes).toEqual([]);
    expect(store.getState().system.ways).toBe(original.ways);
  });

  it('connects onto another line’s interior without absorbing either service', () => {
    const sourceWay = aRoad('source', [A, B]);
    const targetWay = aRoad('target-way', [[-115.19, 36.09], B, [-115.19, 36.11]]);
    const sourcePattern = aPattern('source-pattern', [sourceWay], ['source']);
    const targetPattern = aPattern('target-pattern', [targetWay], ['target-way']);
    const original = aSystem({
      ways: [sourceWay, targetWay],
      services: [
        aService('source-service', [sourcePattern]),
        aService('target-service', [targetPattern]),
      ],
    });
    const source = {
      serviceId: 'source-service',
      patternId: 'source-service',
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = {
      kind: 'service-position' as const,
      serviceId: 'target-service',
      position: patternPositionAt(original.ways, original.services[1].path, 'outbound', 0, 0.5)!,
    };
    const plan = planTerminusGesture(original, source, target);
    const store = createEditorStore();
    store.commands.document.setSystem(original);

    expect(plan.kind).toBe('connect');
    expect(store.commands.services.commitTerminusGesture(source, target, plan)).toBe(true);
    expect(store.getState().system.services.map((service) => service.id)).toEqual([
      'source-service',
      'target-service',
    ]);
  });

  it('renders each side of a committed terminal loop in its actual travel direction', () => {
    const ways = [
      aRoad('a-b', [A, B]),
      aRoad('b-c', [B, C]),
      aRoad('c-d', [C, D]),
      aRoad('d-b', [D, B]),
    ];
    const pattern = aPattern('branch', ways, ['a-b', 'b-c']);
    const original = aSystem({
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
    const source = {
      serviceId: 'bus',
      patternId: 'bus',
      side: 'end' as const,
      purpose: 'extend' as const,
    };
    const target = {
      kind: 'service-position' as const,
      serviceId: 'bus',
      position: patternPositionAt(ways, original.services[0].path, 'outbound', 0, 1)!,
    };
    const plan = planTerminusGesture(original, source, target);
    const store = createEditorStore();
    store.commands.document.setSystem(original);
    store.commands.services.commitTerminusGesture(source, target, plan);
    const committed = store.getState().system;
    const committedPattern = committed.services[0].path;

    expect(patternRunLegs(committedPattern, 'outbound').map(({ leg }) => leg.wayId)).toEqual([
      'a-b',
      'b-c',
    ]);
    expect(patternRunLegs(committedPattern, 'inbound').map(({ leg }) => leg.wayId)).toEqual([
      'c-d',
      'd-b',
      'a-b',
    ]);
    const rendered = buildFeatures(committed, null, [], {
      viewMode: 'network',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    });
    expect(rendered.serviceArrows.features).toHaveLength(3);
  });

  it('clears an armed return when the toolbar tool changes', () => {
    const store = createEditorStore();
    const road = aRoad('road', [A, B]);
    const pattern = aPattern('branch', [road], ['road']);
    store.commands.document.setSystem(
      aSystem({ ways: [road], services: [aService('bus', [pattern])] }),
    );
    store.commands.selection.armTerminus({
      serviceId: 'bus',
      patternId: 'bus',
      side: 'end',
      position: patternPositionAt(
        [road],
        store.getState().system.services[0].path,
        'outbound',
        0,
        1,
      )!,
    });

    store.commands.tools.setTool('way');

    expect(store.getState().armedTerminus).toBeNull();
  });
});
