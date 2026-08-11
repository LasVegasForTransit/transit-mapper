import { aPattern, aRoad, aService, aStation, aSystem } from '@transitmapper/core/testing/fixtures';
import { describe, expect, it } from 'vitest';
import { createInitialEditorState } from '../../../src/editor/store/state';
import { pruneTransientReferences } from '../../../src/editor/store/transient-references';

describe('editor transient references', () => {
  it('keeps live pointers and removes every pointer to deleted document records', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('service', [aPattern('service', [way], [way.id])]);
    const station = aStation('station', [-115.15, 36.1], { wayId: way.id, t: 0.5 });
    const group = { id: 'group', memberIds: [station.id] };
    const system = aSystem({
      ways: [way],
      services: [service],
      stations: [station],
      groups: [group],
    });
    const state = createInitialEditorState('ready');
    state.system = system;
    state.selection = { kind: 'service', id: service.id, stopId: 'deleted-station' };
    state.outlineHover = { kind: 'way', id: way.id, relatedIds: [way.id, 'deleted-way'] };
    state.activePatternId = service.path.id;
    state.armedTerminus = {
      serviceId: service.id,
      patternId: service.path.id,
      side: 'end',
      position: {
        patternId: service.path.id,
        run: 'outbound',
        legIndex: 0,
        wayId: 'deleted-way',
        t: 1,
        distanceMeters: 100,
      },
    };
    state.multiSelection = [
      { kind: 'line', id: system.lines[0].id },
      { kind: 'facility', id: 'deleted-facility' },
    ];
    state.activeWayId = way.id;
    state.routeDraft = {
      modeId: service.modeId,
      lastAnchor: { wayId: way.id, insertIndex: 1, coord: way.points[1] },
      spans: [],
      returnFor: { serviceId: 'deleted-service', patternId: 'deleted-service' },
    };
    state.placingFacilityForGroupId = group.id;
    state.pickingMemberForGroupId = 'deleted-group';
    state.addingServiceDraft = {
      lineId: system.lines[0].id,
      name: 'Branch',
      modeId: service.modeId,
    };
    state.focusNameStationId = 'deleted-station';

    const patch = pruneTransientReferences(state, system);

    expect(patch).toMatchObject({
      selection: { kind: 'service', id: service.id },
      outlineHover: { kind: 'way', id: way.id, relatedIds: [way.id] },
      activePatternId: service.path.id,
      armedTerminus: null,
      multiSelection: [{ kind: 'line', id: system.lines[0].id }],
      activeWayId: way.id,
      routeDraft: null,
      placingFacilityForGroupId: group.id,
      pickingMemberForGroupId: null,
      addingServiceDraft: state.addingServiceDraft,
      focusNameStationId: null,
    });
  });
});
