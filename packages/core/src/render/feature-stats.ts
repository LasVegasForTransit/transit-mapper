import type { FeatureCollection, Geometry } from 'geojson';

export interface RenderFeatureCollectionStats {
  featureCount: number;
  vertexCount: number;
}

function geometryVertexCount(geometry: Geometry): number {
  switch (geometry.type) {
    case 'Point':
      return 1;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates.length;
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates.reduce((sum, part) => sum + part.length, 0);
    case 'MultiPolygon':
      return geometry.coordinates.reduce(
        (sum, polygon) => sum + polygon.reduce((polygonSum, ring) => polygonSum + ring.length, 0),
        0,
      );
    case 'GeometryCollection':
      return geometry.geometries.reduce(
        (sum, childGeometry) => sum + geometryVertexCount(childGeometry),
        0,
      );
  }
}

/** Counts output dimensions without walking individual coordinate positions.
 *
 * GeoJSON paths already store their vertex count in array lengths. Reading
 * those lengths keeps instrumentation proportional to emitted features and
 * geometry parts rather than hundreds of thousands of RTC-scale positions.
 */
export function featureCollectionStats(
  collections: readonly FeatureCollection[],
): RenderFeatureCollectionStats {
  let featureCount = 0;
  let vertexCount = 0;
  for (const collection of collections) {
    featureCount += collection.features.length;
    for (const feature of collection.features) {
      vertexCount += geometryVertexCount(feature.geometry);
    }
  }
  return { featureCount, vertexCount };
}
