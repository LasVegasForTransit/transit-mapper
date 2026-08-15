import { describe, expect, it } from 'vitest';
import { shouldRequestRemoteBasemap } from '../../src/map/basemapLoading';

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
});
