import { describe, expect, it } from 'vitest';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import { aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { Selection } from '../../src/editor/store';
import * as editorOverlays from '../../src/map/editor-overlays';
import {
  canApplyEditorSourceUpdate,
  editorOverlayWorkerInput,
  editorSourcesNeedSystemRefresh,
  planSelectionRenderUpdate,
  projectEditorOverlays,
  type SelectionRenderState,
} from '../../src/map/editor-overlays';

const editorView: RenderViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation: renderPresentationForViewport({
    center: [-115.16, 36.14],
    zoom: 14,
    width: 1_440,
    height: 900,
  }),
};

function state(
  selection: Selection,
  overrides: Partial<SelectionRenderState> = {},
): SelectionRenderState {
  return {
    selection,
    activeWayId: null,
    activePatternId: null,
    armedTerminus: null,
    ...overrides,
  };
}

describe('selection render updates', () => {
  it('maps an explicit Path edit to one semantic Pattern request', () => {
    const service = aService('blue', []);
    const system = aSystem({ services: [service] });
    const candidate = (editorOverlays as Record<string, unknown>).editorPatternOverlayWorkerInput;

    expect(candidate).toBeTypeOf('function');
    if (typeof candidate !== 'function') return;
    const input = candidate({
      system,
      selection: { kind: 'service', id: service.id },
      activePatternId: service.path.id,
      armedTerminus: null,
      view: editorView,
    }) as { serviceId: string; patternId: string } | null;

    expect(input).toMatchObject({ serviceId: service.id, patternId: service.path.id });
    expect(
      candidate({
        system,
        selection: { kind: 'service', id: service.id },
        activePatternId: null,
        armedTerminus: null,
        view: editorView,
      }),
    ).toBeNull();
  });

  it('describes editor geometry as an isolated worker request', () => {
    const system = aSystem();

    expect(
      editorOverlayWorkerInput({
        system,
        selection: { kind: 'way', id: 'way-a' },
        handleWayIds: ['way-a'],
        view: editorView,
      }),
    ).toMatchObject({
      system,
      sourceIds: ['tm-handles', 'tm-physical-handles'],
      selectionOwnedConnectors: false,
    });
  });

  it('projects only editor-owned collections for a selected corridor', () => {
    const system = aSystem({
      ways: [
        aRoad('way-a', [
          [-115.18, 36.14],
          [-115.14, 36.14],
        ]),
      ],
    });

    const features = projectEditorOverlays({
      system,
      selection: { kind: 'way', id: 'way-a' },
      handleWayIds: ['way-a'],
      view: editorView,
    });

    expect(features.handles.features).toHaveLength(2);
    expect(features.ways.features).toEqual([]);
    expect(features.services.features).toEqual([]);
    expect(features.stops.features).toEqual([]);
  });

  it('never lets an editor-only shell become the first retained live scene', () => {
    expect(canApplyEditorSourceUpdate(false, false)).toBe(false);
    expect(canApplyEditorSourceUpdate(true, true)).toBe(false);
    expect(canApplyEditorSourceUpdate(true, false)).toBe(true);
  });

  it('keeps ordinary and junction selection changes on lightweight editor sources', () => {
    for (const selection of [
      { kind: 'station', id: 'station-a' },
      { kind: 'facility', id: 'facility-a' },
      { kind: 'node', id: 'node-a' },
    ] satisfies Exclude<Selection, null>[]) {
      expect(planSelectionRenderUpdate(state(null), state(selection))).toEqual({
        updateEditorSources: true,
        updatePatternOverlay: false,
      });
    }
  });

  it('refreshes an opened Pattern only when visible service-owned state changes', () => {
    const selected = state({ kind: 'service', id: 'service-a' }, { activePatternId: 'pattern-a' });
    const armed = {
      serviceId: 'service-a',
      patternId: 'pattern-a',
      side: 'end' as const,
    };

    expect(planSelectionRenderUpdate(state(null), selected).updatePatternOverlay).toBe(true);
    expect(planSelectionRenderUpdate(selected, state(null)).updatePatternOverlay).toBe(true);
    expect(
      planSelectionRenderUpdate(
        selected,
        state({ kind: 'service', id: 'service-b' }, { activePatternId: 'pattern-a' }),
      ).updatePatternOverlay,
    ).toBe(true);
    expect(
      planSelectionRenderUpdate(selected, { ...selected, activePatternId: 'pattern-b' })
        .updatePatternOverlay,
    ).toBe(true);
    expect(
      planSelectionRenderUpdate(selected, { ...selected, armedTerminus: armed })
        .updatePatternOverlay,
    ).toBe(true);
  });

  it('does not reproject an opened Pattern for unrelated clicks or equal state', () => {
    const before = state({ kind: 'station', id: 'station-a' });
    const after = state({ kind: 'facility', id: 'facility-a' });
    expect(planSelectionRenderUpdate(before, after)).toEqual({
      updateEditorSources: true,
      updatePatternOverlay: false,
    });

    const sameService = state(
      { kind: 'service', id: 'service-a' },
      {
        activePatternId: 'pattern-a',
        armedTerminus: {
          serviceId: 'service-a',
          patternId: 'pattern-a',
          side: 'start',
        },
      },
    );
    const armedTerminus = sameService.armedTerminus;
    if (!armedTerminus) throw new Error('fixture must include an armed terminus');
    expect(
      planSelectionRenderUpdate(sameService, {
        ...sameService,
        selection: { kind: 'service', id: 'service-a' },
        armedTerminus: { ...armedTerminus },
      }),
    ).toEqual({ updateEditorSources: false, updatePatternOverlay: false });
  });

  it('updates editor handles without termini when only the active way changes', () => {
    expect(planSelectionRenderUpdate(state(null), state(null, { activeWayId: 'way-a' }))).toEqual({
      updateEditorSources: true,
      updatePatternOverlay: false,
    });
  });

  it('refreshes editor-owned geometry after selected entity and route mutations', () => {
    for (const changedSources of [
      ['tm-handles'],
      ['tm-physical-handles'],
      ['tm-service-termini'],
    ] as const) {
      expect(editorSourcesNeedSystemRefresh(changedSources, false)).toBe(true);
    }
    expect(editorSourcesNeedSystemRefresh(['tm-facilities'], false)).toBe(false);
    expect(editorSourcesNeedSystemRefresh([], true)).toBe(true);
  });
});
