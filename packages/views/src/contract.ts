import type {
  MAP_VIEW_SCHEMA_VERSION,
  MapViewStateV1,
} from '@transitmapper/core/presentation/map-presentation-state';

// The presentation contracts moved to core so that `@transitmapper/map` and
// `@transitmapper/renderer` can read them without depending on Views. They stay
// re-exported here because every existing consumer imports them from
// `@transitmapper/views`.
export * from '@transitmapper/core/presentation/map-presentation-state';

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
