import { beforeEach, describe, expect, it } from 'vitest';
import type { TransitSystem, Way } from '@transitmapper/core/model/system';
import { FACILITY_TYPE_ORDER, MODES, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { resolveWayPath, wayById } from '@transitmapper/core/model/geo';
import { FEATURE_INPUT_ROLE } from '@transitmapper/core/render/featureInputs';
import { createEditorStore } from '../../src/editor/store';
import { HANDLE_ICON } from '../../src/map/layers';
import { buildHandles } from '@transitmapper/core/render/buildFeatures';
import { required } from '../support/required.test';
import { buildFeatures } from '../support/testRenderPresentation.test';

describe('marker differentiation: handles and every facility type each get a distinct icon, so nothing on the map collapses to an interchangeable dot', () => {
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

describe('performance: resolveWayPath memoizes per way object (drag perf)', () => {
  const way: Way = {
    id: 'w',
    typeId: 'lightRail',
    points: [
      [-115.2, 36.1],
      [-115.15, 36.13],
      [-115.1, 36.1],
    ],
    geometry: 'curved',
    grade: 'atGrade',
    profile: defaultProfileFor('lightRail'),
  };

  it('resolveWayPath returns the identical cached array for the same way object', () => {
    expect(resolveWayPath(way)).toBe(resolveWayPath(way));
  });

  it('resolveWayPath recomputes for a genuinely different way object', () => {
    const first = resolveWayPath(way);
    const changed: Way = { ...way, points: [...way.points, [-115.05, 36.15]] };

    const third = resolveWayPath(changed);

    expect(third).not.toBe(first);
    expect(third.length).toBeGreaterThan(first.length);
  });
});

// --- performance: only the fields buildFeatures reads force a map rebuild ---
// The live map skips its whole 14-collection rebuild when a mutation touched
// nothing renderable (core/render/featureInputs.ts) — that is what stops a
// rename, which arrives one store commit per keystroke, from re-serializing
// multi-megabyte sources. It is only safe if the "meta" half of the
// classification is actually true, so assert it by EXPERIMENT rather than by
// re-reading the table: mutate each meta field and require every collection
// to come out byte-identical. The loop below is driven off FEATURE_INPUT_ROLE
// itself, so a newly added meta field with no case here fails rather than
// going unchecked.
describe('performance: only the fields buildFeatures reads force a map rebuild', () => {
  let base: TransitSystem;
  let roadId: string;
  let render: (s: TransitSystem) => ReturnType<typeof buildFeatures>;
  let collections: (fc: ReturnType<typeof buildFeatures>) => Record<string, string>;
  let baseline: Record<string, string>;

  beforeEach(() => {
    const store = createEditorStore();
    roadId = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(roadId, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(roadId, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const crossId = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(crossId, [-115.15, 36.05]);
    store.commands.ways.addWayPoint(crossId, [-115.15, 36.15]);
    store.commands.ways.finishWay();
    store.commands.network.formCrossingJunctions(crossId);
    store.commands.stops.addStop([-115.15, 36.1]);
    store.commands.facilities.addFacility(FACILITY_TYPE_ORDER[0], [-115.14, 36.11]);
    store.commands.services.addServiceToWay(roadId);
    store.commands.ways.nameWay(roadId, 'Decatur Avenue');

    const view = {
      viewMode: 'infrastructure' as const,
      laneDetail: true,
      visibleModes: new Set(Object.keys(MODES)),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    };
    base = store.getState().system;
    render = (s: TransitSystem) => buildFeatures(s, null, [], view);
    collections = (fc) =>
      Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, JSON.stringify(v)]));
    baseline = collections(render(base));
  });

  // Without this the whole block could pass vacuously: if buildFeatures
  // emitted nothing at all, every comparison below would trivially hold.
  it('the rebuild-classification fixture actually renders something', () => {
    const nonEmpty = Object.values(baseline).filter(
      (json) => !json.includes('"features":[]'),
    ).length;

    expect(nonEmpty).toBeGreaterThanOrEqual(4);
  });

  const metaMutations: Partial<
    Record<keyof TransitSystem, (base: TransitSystem, roadId: string) => TransitSystem>
  > = {
    id: (b) => ({ ...b, id: 'some-other-id' }),
    name: (b) => ({ ...b, name: 'Renamed system' }),
    description: (b) => ({ ...b, description: 'a description' }),
    viewport: (b) => ({ ...b, viewport: { center: [-116.5, 37.2], zoom: 14 } }),
    createdAt: (b) => ({ ...b, createdAt: b.createdAt + 5000 }),
    updatedAt: (b) => ({ ...b, updatedAt: b.updatedAt + 5000 }),
    palette: (b) => ({ ...b, palette: ['#ff0000', '#00ff00'] }),
    drivingSide: (b) => ({ ...b, drivingSide: b.drivingSide === 'right' ? 'left' : 'right' }),
    vehicleKinds: (b) => ({
      ...b,
      vehicleKinds: [
        { id: 'vk1', modeId: 'bus', label: "40' Standard Bus", widthM: 2.6, lengthM: 12.2 },
      ],
    }),
    medians: (b, wayId) => ({
      ...b,
      medians: { [`${wayId}:median`]: { widthM: 3, kindId: 'painted' } },
    }),
    approachControls: (b, wayId) => ({
      ...b,
      approachControls: { [`${wayId}:start`]: { control: 'signal' } },
    }),
  };

  for (const [key, role] of Object.entries(FEATURE_INPUT_ROLE) as [
    keyof TransitSystem,
    'render' | 'meta',
  ][]) {
    if (role !== 'meta') continue;
    // `version` is a literal type with exactly one legal value, so there is
    // no different-but-still-valid document to compare against.
    if (key === 'version') continue;

    it(`changing ${key} rebuilds no map features, so it is safely classified meta`, () => {
      const mutate = metaMutations[key];
      expect(
        mutate,
        `meta field "${key}" has a case in the rebuild-classification check`,
      ).toBeDefined();
      if (!mutate) return;

      const after = collections(render(mutate(base, roadId)));
      const differing = Object.keys(baseline).filter((c) => baseline[c] !== after[c]);

      expect(differing).toEqual([]);
    });
  }

  // Positive control for the other direction: a render field really does
  // change the output, so the equality assertions above are meaningful.
  it('changing ways does rebuild map features, so the meta assertions are not vacuous', () => {
    const moved = base.ways.map((w) =>
      w.id === roadId ? { ...w, points: [w.points[0], [-115.05, 36.2] as [number, number]] } : w,
    );

    const after = collections(render({ ...base, ways: moved }));

    expect(Object.keys(baseline).some((c) => baseline[c] !== after[c])).toBe(true);
  });
});
