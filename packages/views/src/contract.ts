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

export interface SharedSystemMapReferenceV1 {
  kind: 'shared-system';
  id: string;
}

export interface SavedViewV1 {
  schemaVersion: typeof MAP_VIEW_SCHEMA_VERSION;
  id: string;
  title: string;
  description?: string;
  map: SharedSystemMapReferenceV1;
  state: MapViewStateV1;
}
