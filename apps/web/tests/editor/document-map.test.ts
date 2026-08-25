import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { MODE_ORDER, MODES, WAY_TYPE_ORDER, WAY_TYPES } from '@transitmapper/core/model/catalog';
import { createMapViewStore } from '@transitmapper/map';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import {
  createAttachOptions,
  createProjectionWorker,
  DocumentDriverClock,
  TestDocumentMap,
} from '../../../../packages/renderer/tests/support/document-map-driver.test';
import {
  createEditorDocumentMap,
  DOCUMENT_MAP_DEFINITION,
  resolveDocumentMapPresentation,
} from '../../src/editor/document-map';
import { createDocumentPresentationState } from '../../src/editor/document-view-adapter';
import { createEditorStore } from '../../src/editor/store';

describe('the editor document map composition', () => {
  it('defines the current representations and filter catalog', () => {
    expect(DOCUMENT_MAP_DEFINITION).toEqual({
      id: 'document',
      title: 'Transit system',
      representations: [
        { id: 'network', label: 'Network' },
        { id: 'infrastructure', label: 'Infrastructure' },
        { id: 'diagram', label: 'Diagram' },
      ],
      filters: [
        {
          kind: 'multi-select',
          id: 'modes',
          label: 'Services',
          options: MODE_ORDER.map((id) => ({ id, label: MODES[id].label })),
          defaultValue: MODE_ORDER,
        },
        {
          kind: 'multi-select',
          id: 'way-types',
          label: 'Infrastructure',
          options: WAY_TYPE_ORDER.map((id) => ({ id, label: WAY_TYPES[id].label })),
          defaultValue: WAY_TYPE_ORDER,
        },
        {
          kind: 'toggle',
          id: 'landmarks',
          label: 'Landmarks',
          defaultValue: true,
        },
      ],
      attribution: [],
    });
  });

  it('resolves bounded document presentation values', () => {
    const presentation = resolveDocumentMapPresentation({
      ...createDocumentPresentationState(),
      representationId: 'infrastructure',
      filters: {
        modes: ['bus', 'ferry'],
        'way-types': ['road', 'water'],
        landmarks: false,
      },
    });

    expect(presentation.viewMode).toBe('infrastructure');
    expect([...presentation.visibleModes]).toEqual(['bus', 'ferry']);
    expect([...presentation.visibleWayTypes]).toEqual(['road', 'water']);
  });

  it.each([
    ['unknown representation', { representationId: 'globe' }],
    ['non-array modes', { filters: { modes: true } }],
    ['unknown mode', { filters: { modes: ['bus', 'teleporter'] } }],
    ['non-string mode', { filters: { modes: ['bus', 12] } }],
    ['non-array way types', { filters: { 'way-types': false } }],
    ['unknown way type', { filters: { 'way-types': ['road', 'tunnel'] } }],
    ['non-string way type', { filters: { 'way-types': ['road', null] } }],
  ])('falls back to current defaults for %s', (_name, change) => {
    const initial = createDocumentPresentationState({ representationId: 'diagram' });
    const state = {
      ...initial,
      ...change,
      filters: { ...initial.filters, ...('filters' in change ? change.filters : {}) },
    };

    const presentation = resolveDocumentMapPresentation(state);

    expect(['network', 'infrastructure', 'diagram']).toContain(presentation.viewMode);
    if ('representationId' in change) expect(presentation.viewMode).toBe('network');
    if ('filters' in change && 'modes' in change.filters) {
      expect([...presentation.visibleModes]).toEqual(MODE_ORDER);
    }
    if ('filters' in change && 'way-types' in change.filters) {
      expect([...presentation.visibleWayTypes]).toEqual(WAY_TYPE_ORDER);
    }
  });

  it('passes editor snapshots and injected rendering policy into the document driver', async () => {
    const store = createEditorStore();
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const layers: readonly LayerSpecification[] = [];
    const layerSpecs = vi.fn(() => layers);
    const setupStaticSources = vi.fn((_map: MapLibreMap) => {});
    const sessionDispose = vi.fn();
    const attachSession = vi.fn((_session: DocumentMapSession, _signal: AbortSignal) => ({
      dispose: sessionDispose,
    }));
    const createFeatureProjectionWorker = vi.fn(() => worker);
    const composition = createEditorDocumentMap({
      store,
      layerSpecs,
      setupStaticSources,
      attachSession,
      createFeatureProjectionWorker,
      scheduler: clock,
    });
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const viewStore = createMapViewStore(createDocumentPresentationState());

    const attachment = await composition.driver.attach(
      createAttachOptions(map, milestones, errors, {
        viewStore,
        selection: composition.selection,
      }),
    );

    expect(composition.driver.definition).toBe(DOCUMENT_MAP_DEFINITION);
    expect(composition.source.getSnapshot().system).toBe(store.getState().system);
    expect(composition.selection.getSnapshot()).toBeUndefined();
    expect(createFeatureProjectionWorker).toHaveBeenCalledOnce();
    expect(layerSpecs).toHaveBeenCalled();
    expect(setupStaticSources).toHaveBeenCalledWith(map);
    const [session, sessionSignal] = attachSession.mock.calls[0] ?? [];
    expect(session.map).toBe(map);
    expect(session.renderer).toBeDefined();
    expect(sessionSignal).toBeInstanceOf(AbortSignal);
    expect(errors).toEqual([]);

    attachment.dispose();

    expect(sessionDispose).toHaveBeenCalledOnce();
    expect(worker.dispose.mock.calls).toHaveLength(1);
  });
});
