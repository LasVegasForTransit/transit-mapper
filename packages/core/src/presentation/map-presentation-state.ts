// The presentation half of the map-view contract lives here, apart from the
// stored view record in `@transitmapper/views`, because a map driver has to
// read and write this state without knowing that saved views exist. Keeping
// the two together forced `@transitmapper/map` and `@transitmapper/renderer`
// to depend on Views, which inverts the intended direction.

export const MAP_VIEW_SCHEMA_VERSION = 1 as const;

export type RepresentationId = string;

export type MapFilterValue = boolean | string | readonly string[];

export interface MapCameraStateV1 {
  center: [number, number];
  zoom: number;
}

export interface MapFeatureReferenceV1 {
  source: string;
  kind: string;
  id: string;
}

export interface MapPresentationStateV1 {
  schemaVersion: typeof MAP_VIEW_SCHEMA_VERSION;
  camera: MapCameraStateV1;
  representationId: RepresentationId;
  filters: Record<string, MapFilterValue>;
}

export interface MapViewStateV1 extends MapPresentationStateV1 {
  selection?: MapFeatureReferenceV1;
}
