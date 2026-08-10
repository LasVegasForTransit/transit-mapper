import { ONBOARDING_FIXTURE_SYSTEM } from './fixtureSystem';

interface OnboardingContextProperties {
  kind: 'airport' | 'district' | 'park' | 'river';
  name: string;
}

/** Geographic context is presentation-only because water and neighborhoods
 * are not TransitSystem entities. It is still fixed local data: no basemap or
 * tile request is needed to explain why the bridge controls Crosstown. */
export const ONBOARDING_CONTEXT_FEATURES: GeoJSON.FeatureCollection<
  GeoJSON.Polygon,
  OnboardingContextProperties
> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { kind: 'river', name: 'Mason River' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.464, 37.728],
            [-122.447, 37.728],
            [-122.448, 37.744],
            [-122.445, 37.759],
            [-122.449, 37.777],
            [-122.465, 37.779],
            [-122.463, 37.76],
            [-122.466, 37.745],
            [-122.464, 37.728],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'district', name: 'Downtown' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.447, 37.747],
            [-122.432, 37.747],
            [-122.43, 37.761],
            [-122.445, 37.764],
            [-122.447, 37.747],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'park', name: 'Eastgate Commons' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.433, 37.762],
            [-122.423, 37.762],
            [-122.421, 37.772],
            [-122.431, 37.773],
            [-122.433, 37.762],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'airport', name: 'Port Mason Airport' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.435, 37.728],
            [-122.418, 37.728],
            [-122.416, 37.74],
            [-122.433, 37.741],
            [-122.435, 37.728],
          ],
        ],
      },
    },
  ],
};

interface OnboardingStreetProperties {
  kind: 'arterial' | 'local';
}

/** A muted street basemap made from the same imported Way records the bus
 * actually follows. Network and operating scenes retain geographic evidence
 * without making a tile request or inventing a second route geometry. */
export const ONBOARDING_STREET_FEATURES: GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  OnboardingStreetProperties
> = {
  type: 'FeatureCollection',
  features: ONBOARDING_FIXTURE_SYSTEM.ways
    .filter((way) => way.typeId === 'road')
    .map((way) => ({
      type: 'Feature',
      properties: {
        kind: way.id.includes('arc') || way.id.includes('belt') ? 'arterial' : 'local',
      },
      geometry: { type: 'LineString', coordinates: way.points },
    })),
};
