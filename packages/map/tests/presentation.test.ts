import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import {
  createDocumentPresentationState,
  DOCUMENT_VIEW_FILTER_IDS,
  resolveDocumentMapPresentation,
} from '../src/presentation';

describe('document map presentation', () => {
  it('creates the shared default used by every document map host', () => {
    const state = createDocumentPresentationState({
      camera: { center: [-73.98, 40.75], zoom: 12 },
      representationId: 'infrastructure',
    });

    expect(state).toEqual({
      schemaVersion: 1,
      camera: { center: [-73.98, 40.75], zoom: 12 },
      representationId: 'infrastructure',
      filters: {
        [DOCUMENT_VIEW_FILTER_IDS.modes]: [...MODE_ORDER],
        [DOCUMENT_VIEW_FILTER_IDS.wayTypes]: [...WAY_TYPE_ORDER],
        [DOCUMENT_VIEW_FILTER_IDS.landmarks]: true,
      },
    });
    expect(resolveDocumentMapPresentation(state)).toEqual({
      viewMode: 'infrastructure',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    });
  });
});
