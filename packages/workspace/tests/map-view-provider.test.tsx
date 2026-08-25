// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMapViewStore } from '@transitmapper/map';
import { describe, expect, it } from 'vitest';
import * as workspace from '../src/index';

const { MapViewProvider, useMapViewStore } = workspace;

function StoreReader() {
  return <output>{useMapViewStore().getSnapshot().representationId}</output>;
}

describe('MapViewProvider', () => {
  it('provides the injected store without an editor or web provider', () => {
    const store = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.17, 36.17], zoom: 10 },
      representationId: 'infrastructure',
      filters: {},
    });
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() =>
      root.render(
        <MapViewProvider store={store}>
          <StoreReader />
        </MapViewProvider>,
      ),
    );

    expect(container.textContent).toBe('infrastructure');
    act(() => root.unmount());
  });
});
