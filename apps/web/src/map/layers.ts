/**
 * MapLibre layer vocabulary: source and layer IDs, icon registration, and
 * paint specifications. Geometry belongs to `@transitmapper/core/render` and
 * is deliberately not re-exported here: a caller asking for a layer constant
 * must not pull the CPU feature builder into an editor delivery chunk.
 */
export * from './layers/constants';
export * from './layers/icons';
export * from './layers/layerSpecs';
