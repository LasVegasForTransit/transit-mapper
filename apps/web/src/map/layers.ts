// Barrel: this file split into layers/ (shared SRC_*/LYR_* constants, the
// system-to-GeoJSON projector, the MapLibre layer paint specs, and icon
// registration) once it grew past four genuinely separate concerns living in
// one 982-line file. Every existing named export is re-exported unchanged
// from its new home, so no import path anywhere in the app needed to change.
//
// buildFeatures later moved out of the app entirely, into core, so the Worker
// can build the same features when it draws a shared system for a preview
// image or an embed. It's re-exported through this barrel too, so that move
// also changed no import path in the app.
export * from "./layers/constants";
export * from "./layers/icons";
export * from "@transitmapper/core/render/buildFeatures";
export * from "./layers/layerSpecs";
