import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { initialBaseStyleTiming, shouldRequestRemoteBasemap } from '../../src/map/basemapLoading';

describe('deferred basemap loading', () => {
  it('waits for the committed document and requests the remote basemap only once', () => {
    expect(
      shouldRequestRemoteBasemap({ documentReady: false, remoteBasemapRequested: false }),
    ).toBe(false);
    expect(shouldRequestRemoteBasemap({ documentReady: true, remoteBasemapRequested: false })).toBe(
      true,
    );
    expect(shouldRequestRemoteBasemap({ documentReady: true, remoteBasemapRequested: true })).toBe(
      false,
    );
  });

  it('loads the basemap before content when the document has nothing to paint first', () => {
    expect(initialBaseStyleTiming(createEmptySystem())).toBe('before-content');
  });

  it('keeps the basemap behind content when the document already has transit', () => {
    const system = createEmptySystem();
    expect(
      initialBaseStyleTiming({
        ...system,
        stops: [
          {
            id: 'stop-1',
            name: 'Downtown',
            coord: [-115.14, 36.17],
          } as (typeof system.stops)[number],
        ],
      }),
    ).toBe('after-content');
  });
});
