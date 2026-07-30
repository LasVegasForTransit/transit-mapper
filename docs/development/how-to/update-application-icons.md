# Update application icons

TransitMapper generates browser identity from the same Lucide Route geometry
as the editor's Line tool. The web generator publishes adaptive SVGs, raster
fallbacks, favicons, the social-card mark, and the input layer used by Apple's
Icon Composer.

## Generated web assets

Run:

```bash
pnpm --filter @transitmapper/web generate:icons
```

The six manifest install variants receive one content revision derived from
their ordered roles and exact bytes. Their public URLs use that revision under
`/icons/`; favicons and the Apple touch icon keep stable URLs because browsers
discover them through different metadata.

The generator replaces only the manifest's icon set and managed icon assets.
It preserves the other manifest members and removes obsolete managed
revisions. Running the command twice without changing its inputs produces the
same revision and bytes.

## Apple Icon Composer export

The Apple touch icon uses Apple's Liquid Glass renderer, which the
cross-platform generator cannot reproduce. The generator updates the unioned
Route silhouette inside the committed `transit-mapper.icon` document. Open
that document in Icon Composer, export a flattened 1024px PNG to
`apps/web/scripts/apple-touch-icon-source.png`, then record and resize the
export:

```bash
pnpm --filter @transitmapper/web generate:icons -- --record-apple-export
```

The unioned silhouette must remain one layer. Separate overlapping strokes
become separate glass surfaces and produce visible seams. The recorded
provenance lets normal check mode detect a stale native export without trying
to emulate Apple's proprietary renderer.

The Apple-only Route layer uses a 16dp left and right inset in the 180px touch
icon. Browser and manifest icons keep their independent regular and maskable
scales; changing the Apple inset must not resize those assets.

## Installed application updates

Changing icon bytes changes every manifest install URL. Chrome treats icon
URLs as immutable identity resources, so publishing different bytes at an
unchanged URL does not update an installed application. Chrome 144 and later
stage changed icon URLs behind a **Review app update** confirmation; activate
the web-app update, restart Chrome if needed, and approve that review.

Chrome documents the security behavior and user flow in
[Improvements to web app updates](https://developer.chrome.com/blog/improvements-to-web-app-updates/).
An already-installed macOS launcher icon is a platform-generated raster and
does not switch live with the operating system theme.

Safari consumes the stable Apple touch-icon URL and does not support the
layered Icon Composer source. Existing Add to Dock installations may require
removal and reinstallation before they adopt a changed export.

## Verification

Run the generator a second time, then check its committed-output mode:

```bash
pnpm --filter @transitmapper/web generate:icons
pnpm --filter @transitmapper/web generate:icons -- --check
```

Finish with the repository and production-output checks:

```bash
pnpm check
pnpm build
pnpm --filter @transitmapper/web exec tsx scripts/perf/verify-pwa-output.ts
```

Inspect the built manifest to confirm that all six install URLs carry the same
revision, every referenced asset exists, and the service worker precaches
those URLs.
