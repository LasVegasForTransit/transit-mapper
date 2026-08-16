import { describe, expect, it } from 'vitest';
import { LANDMARKS, landmarksFeatureCollection } from '../../src/map/landmarks';

describe('landmarks are a fixed set of named reference points, exposed to the map as a GeoJSON feature collection', () => {
  it('every landmark has a real name and a valid [lng,lat] coord', () => {
    // coord.length === 2 isn't asserted here: LngLat is a 2-tuple, so that
    // comparison would only be checking what the type system already
    // guarantees, not a runtime fact worth testing.
    expect(
      LANDMARKS.every(
        (l) => l.name.length > 0 && Math.abs(l.coord[0]) <= 180 && Math.abs(l.coord[1]) <= 90,
      ),
    ).toBe(true);
  });

  it('landmarksFeatureCollection carries one feature per landmark', () => {
    const fc = landmarksFeatureCollection();
    expect(fc.features.length).toBe(LANDMARKS.length);
  });

  it("each feature's name property round-trips", () => {
    const fc = landmarksFeatureCollection();
    expect(fc.features.map((f) => f.properties.name)).toEqual(LANDMARKS.map((l) => l.name));
  });
});
