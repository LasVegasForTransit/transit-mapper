import { describe, expect, it } from 'vitest';
import { serviceWayIds } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';

describe('adding a Service to a public Line', () => {
  it('uses the technical label and mode chosen before drawing', () => {
    const store = createEditorStore();
    const trunkWayId = store.commands.ways.beginWay('lightRail', 'straight');
    if (!trunkWayId) throw new Error('The trunk way must be created.');
    store.commands.ways.addWayPoint(trunkWayId, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(trunkWayId, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const line = store.getState().system.lines[0];

    store.commands.services.startAddingServiceToLine(line.id, {
      name: 'Construction shuttle',
      modeId: 'bus',
    });
    const shuttleWayId = store.commands.ways.beginWay('road', 'straight');
    if (!shuttleWayId) throw new Error('The shuttle way must be created.');
    store.commands.ways.addWayPoint(shuttleWayId, [-115.2, 36.11]);
    store.commands.ways.addWayPoint(shuttleWayId, [-115.1, 36.11]);
    store.commands.ways.finishWay();

    const shuttle = store
      .getState()
      .system.services.find((service) => serviceWayIds(service).includes(shuttleWayId));
    expect(shuttle).toMatchObject({ name: 'Construction shuttle', modeId: 'bus' });
    expect(store.getState().system.lines[0].serviceIds).toContain(shuttle?.id);
  });
});
