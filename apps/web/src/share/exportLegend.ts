// Moved to core (render/legend.ts) so the Worker's preview renderer builds
// the same legend the app's exports do. Re-exported here so existing import
// paths in the app are unchanged.
export { legendEntriesFor, type LegendEntry } from "@transitmapper/core/render/legend";
