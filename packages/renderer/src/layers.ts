// Layer and source identity only. The MapLibre source banks that give these
// logical ids physical layers now live in `@transitmapper/map/layers`, which
// re-exports this module so a caller needing both still has one import.
export * from './layers/constants';
export {
  ALL_SYSTEM_FEATURE_SOURCES,
  committedSystemFeatureSources,
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
  emptySystemFeatures,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';
