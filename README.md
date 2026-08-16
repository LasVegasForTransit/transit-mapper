# TransitMapper

[![Deploy production](https://github.com/LasVegasForTransit/transit-mapper/actions/workflows/deploy-production.yml/badge.svg)](https://github.com/LasVegasForTransit/transit-mapper/actions/workflows/deploy-production.yml)

> TransitMapper is in open beta. It changes frequently as we learn what works,
> and features, workflows, and data formats may change before a stable release.
> Export important systems you want to keep long term.

Design regional transit systems on a real map. Sketch lines the way you'd
sketch them on a napkin, then build out the physical network underneath:
streets with lanes and turn pockets, rail with real track counts,
intersections that form themselves, stations with land and structures.

TransitMapper is an open-source project of
[Las Vegans for Better Transit](https://lasvegasfortransit.org). It models a
better transit future for the Las Vegas Valley, but nothing in it is specific
to one city or one transit agency.

## Features

- Draw transit lines on an interactive map, the way you'd sketch them on
  paper.
- Design real streets and rail lines, with lanes, medians, one-way
  traffic, and divided boulevards.
- Watch intersections build themselves automatically when roads or
  tracks cross.
- Add stations with real buildings, platforms, and bus bays, not just a
  dot on a map.
- Import real streets from OpenStreetMap instead of drawing every block
  by hand.
- Zoom out for a clean, simple transit map, or zoom into the physical
  street layout underneath it.
- Everything saves automatically in your browser. Share a link to your
  system, and anyone can view it or make their own copy. Shared links last a
  week from the last time someone opened them; permanent links are waiting on
  accounts (see [ROADMAP.md](ROADMAP.md)).
- Paste that link anywhere and the preview shows the actual system, or
  embed a live read-only map in a blog post with an iframe.

## Quick start

```sh
pnpm install
pnpm dev        # editor at http://localhost:5173
```

Other commands:

```sh
pnpm verify     # run the test suites
pnpm typecheck  # TypeScript, app + worker
pnpm build      # production build
```

`typecheck`, `build`, and `verify` run through [Turborepo](https://turborepo.com)
for caching, so a repeat run with unchanged inputs replays instantly instead
of re-invoking `tsc`/`vite`/`tsx`.

The share/fork backend is a Cloudflare Worker with D1 (`pnpm worker:dev`),
but the editor runs fully without it.

## Documentation

Docs live in [`docs/`](docs/README.md):

- [Getting started tutorial](docs/product/tutorials/getting-started.md) — build your
  first system in ten minutes.
- [How-to guides](docs/README.md#how-to-guides) — draw roads, design
  stations, route services, import OSM data.
- [Reference](docs/README.md#reference) — the data model, catalogs,
  keyboard shortcuts, project structure.
- [Explanation](docs/README.md#explanation) — why the editor works the way
  it does: the three views, the design principles, the geometry engine.

## Roadmap

Right now this is a sketching and sharing tool. Ridership and
travel-time analysis come next, then accounts so people can work on a
system together. See [ROADMAP.md](ROADMAP.md) for specifics.

## Contributing

Contributions are welcome, and not just code. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to report a bug, suggest a
feature, or submit a change.

## Acknowledgements

TransitMapper self-hosts the Public Sans variable Latin font from
`@fontsource-variable/public-sans@5.2.7`. The font is licensed under the
[SIL Open Font License 1.1](apps/web/src/assets/public-sans-ofl.txt).

## License

This project is licensed under the [MIT License](LICENSE).
