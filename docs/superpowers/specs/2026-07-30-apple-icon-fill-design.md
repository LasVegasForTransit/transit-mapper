# Apple icon mark fill

## Context

The Route silhouette in the Apple touch icon reads smaller than neighboring
macOS Dock marks. Its current `0.88` scale leaves about 14% horizontal padding
before Icon Composer applies Liquid Glass.

## Design

Only the Apple Icon Composer input layer changes. The Route silhouette uses a
dedicated `1.0` scale, which gives the 180px Apple touch icon a 16dp inset on
its left and right edges. The exact Lucide Route geometry, 45-degree rotation,
stroke proportions, LVBT Ember background, and Combined Liquid Glass settings
remain unchanged.

Browser favicons, manifest icons, maskable icons, and the Open Graph image keep
their existing scale. The Apple scale is named separately from the regular and
maskable browser scales so a future browser-icon adjustment cannot silently
resize the platform-specific artwork.

## Generation and verification

The generator produces the enlarged, unioned alpha layer in the committed Icon
Composer document. Icon Composer then exports the 1024px flattened source, and
the generator records its updated provenance before producing the 180px public
asset.

Verification checks the generated Apple layer's horizontal alpha bounds rather
than matching SVG source text or hand-authored path data. The repository icon
generation check, `pnpm check`, and `pnpm build` remain the completion gates.
