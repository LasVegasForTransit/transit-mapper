# Automatic MD3 light and dark theme

## Context

TransitMapper's editor chrome currently uses a small light-only variable set, while its MapLibre
layers contain additional light-only colors. The live map occupies the whole viewport, so darkening
only the floating controls would leave the brightest surface unchanged. Static exports have a
different constraint: they appear in documents and clients that cannot react to the viewer's color
scheme.

The operating system is the only theme authority. TransitMapper does not store a theme preference,
add a settings control, or serialize appearance with a system.

## Theme system

The UI uses Material Design 3 semantic roles without adopting Material components or a colored
application accent. Light mode keeps the existing ink-on-paper character. Dark mode uses warm
neutral charcoal containers, light foreground roles, scheme-aware outlines, and Material error
roles. Typography, shape, and elevation also use named roles so components do not invent local
values.

CSS resolves the application theme through `prefers-color-scheme`. A small browser service exposes
the same resolved `light | dark` value to imperative surfaces such as MapLibre. Unsupported browsers
and non-browser tests resolve to light. The service never reads or writes storage.

User-authored colors are data. Stored line colors, swatches, route rendering, vehicles, legends, and
exports are never remapped, lightened, or desaturated. The theme controls only the neutral substrate
and editing affordances around that content.

## Maps

The live editor and embed use OpenFreeMap Positron in light mode and OpenFreeMap Dark in dark mode.
TransitMapper's neutral layers use a typed cartographic palette for backgrounds, labels, halos,
handles, footprints, lane markings, landmarks, and selection state. Neutral contrast casings sit
beneath colored routes so near-white and near-black user colors remain visible without changing the
colors themselves.

A live operating-system change fetches the next basemap while the current map stays usable. Drawing
and direct manipulation defer the swap until the gesture ends. MapLibre's style transform carries
TransitMapper sources and themed layers into the incoming style. One idempotent recovery path
restores icons, data, visibility, feature state, and simulation state after either a diff or a full
style rebuild. A failed runtime fetch keeps the working style.

Diagram mode and the local no-basemap fallback use the resolved scheme's background. The editor,
share page, onboarding previews, and embed follow the operating system.

## Static output

The export preview, PNG and SVG renderers, share-preview cards, and worker-generated images remain
explicitly light. Their appearance is stable, print-friendly, and independent of the operating
system that happened to create them.

## Testing

Ordinary Vitest tests cover scheme observation, token completeness, cartographic layer parity,
preservation of user-color expressions, gesture-safe style switching, stale requests, fallback
behavior, and the light-only export boundary. Browser acceptance covers desktop and mobile, live
operating-system changes, drawing and dragging, custom colors, embeds, basemap failures, and light
export from a dark editor. `pnpm perf` and `pnpm check` remain the completion gates.
