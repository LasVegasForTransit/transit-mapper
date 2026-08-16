import { beforeEach, describe, expect, it } from 'vitest';
import { FACILITY_TYPE_ORDER, MODES } from '@transitmapper/core/model/catalog';
import { wayById } from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';
import { HANDLE_ICON } from '../../src/map/layers';
import { buildHandles } from '@transitmapper/core/render/buildFeatures';
import { required } from '../support/required.test';
import { buildFeatures } from '../support/testRenderPresentation.test';

// beginWay(typeId, ...) without an explicit setDraftMode(...) call attaches a
// service using the store's default draftModeId ('lightRail', which is
// compatible with the 'road' way type) — see
// src/editor/store/internal-operations/way-creation.ts's compatibleModeId.
// Cases below that don't set the mode explicitly are implicitly exercising
// lightRail, not a specific documented choice.

describe('every handle and facility type gets a distinct icon, so nothing on the map collapses to an interchangeable dot', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;
  let filters: { visibleModes: Set<string>; visibleWayTypes: Set<string> };

  beforeEach(() => {
    store = createEditorStore();
    road = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  });

  it('way interior handles use the shared square control-point icon', () => {
    const withHandles = buildFeatures(store.getState().system, null, [road], {
      viewMode: 'infrastructure',
      ...filters,
    });

    expect(withHandles.handles.features.every((f) => f.properties?.icon === HANDLE_ICON)).toBe(
      true,
    );
  });

  // The selection fast path (map/MapCanvas.tsx) drives this builder DIRECTLY
  // rather than running the full fourteen-collection build and discarding
  // twelve of its outputs. Sound only while the two agree feature-for-feature,
  // so pin it: otherwise clicking an object could render different handles
  // than a full rebuild does.
  it('buildHandles alone emits exactly what the full build emits', () => {
    const withHandles = buildFeatures(store.getState().system, null, [road], {
      viewMode: 'infrastructure',
      ...filters,
    });
    const standalone = buildHandles(wayById(store.getState().system.ways), [road]);

    expect(JSON.stringify({ type: 'FeatureCollection', features: standalone })).toBe(
      JSON.stringify(withHandles.handles),
    );
  });

  it('buildHandles emits one handle per control point', () => {
    const standalone = buildHandles(wayById(store.getState().system.ways), [road]);
    const way = store.getState().system.ways.find((w) => w.id === road);

    expect(standalone).toHaveLength(way?.points.length ?? -1);
  });

  describe('facility icons', () => {
    let icons: Map<string, string>;

    beforeEach(() => {
      for (const typeId of FACILITY_TYPE_ORDER) {
        store.commands.facilities.addFacility(typeId, [-115.15, 36.1]);
      }
      const infra = buildFeatures(
        store.getState().system,
        null,
        [],
        {
          viewMode: 'infrastructure',
          ...filters,
        },
        null,
        null,
        // These facilities all sit on the same coordinate, so screen-density
        // culling (which merges nearby markers) would otherwise collapse
        // them to one — defeating the point of this check.
        { applyScreenDensity: false },
      );
      icons = new Map();
      for (const f of infra.facilities.features) {
        icons.set(f.properties?.typeId as string, f.properties?.icon as string);
      }
    });

    for (const typeId of FACILITY_TYPE_ORDER) {
      it(`facility "${typeId}" has an icon`, () => {
        const icon = icons.get(typeId);

        expect(typeof icon).toBe('string');
        expect(icon?.length ?? 0).toBeGreaterThan(0);
      });
    }

    it('every facility type gets its own distinct icon (none share one)', () => {
      expect(new Set(icons.values()).size).toBe(FACILITY_TYPE_ORDER.length);
    });
  });
});
