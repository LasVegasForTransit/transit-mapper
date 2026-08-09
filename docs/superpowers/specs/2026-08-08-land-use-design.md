# Land use visualization

## Reader and purpose

This document is for a developer or contributor who will build, review, or
extend the land use subsystem. After reading it, that person can say what a
land use layer is, where its data comes from, what transformations it passed
through, why it is drawn the way it is drawn, and what the design refuses to
claim.

It assumes the reader has read
[Design principles](../../product/explanation/design-principles.md), whose rules
this design keeps, and
[The simulation](../../product/explanation/simulation.md), whose resolved
architecture it deliberately matches.

Part 1 explains geospatial data from nothing. Contributors range from
first-timers to transit advocates who write some TypeScript, and every later
decision depends on distinctions that are invisible until someone names them.

## The problem

TransitMapper draws a network on a real map and knows nothing about the ground
under it. The landmark layer says so in its own comment: six hand-placed points
are the cheap stand-in for a real population and employment layer. Six labels
are the whole of what the tool knows about why an alignment belongs in one place
rather than another.

That gap blocks Phase 2 of the roadmap. Ridership sketching and travel-time
comparison both need to know who and what is on the ground. So does the argument
that moves a city council: this corridor serves forty thousand jobs and twenty-five
thousand people who own no car, and land along it has appreciated since the last
line opened.

## Scope

This design covers reference data on the map: zoning, assessed land value,
population, jobs, and pollution, for any US city, with sources stated. It covers
the acquisition pipeline that produces that data and the normalization corpus
that makes it comparable across jurisdictions.

It does not cover ridership modelling, land-value forecasting, or return on
investment. Those depend on this design and get their own. What this document
does guarantee is that a modelled value and a measured one are the same kind of
thing, so those features are additions rather than a second architecture.

## Prior decisions

| Question           | Decision                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| First slice        | Reference layers, with a legend and click-to-inspect. No modelling, and no modelled time axis — only whichever vintages the pipeline fetched.  |
| Coverage           | Pluggable. The app reads a manifest URL. Curated regions build in CI; anyone may host their own.                                               |
| Analysis substrate | Hex binning is a defined pipeline stage, built but unpublished in the first release.                                                           |
| Renderer           | Today's map library. Everything except pushing values at the renderer stays pure, so a future engine replaces one shim.                        |
| Licensing          | Data URLs resolve through the manifest rather than being fixed in code, so access control stays a configuration change. Everything ships open. |

---

## Part 1 — What the data is

### Vectors and rasters

There are two ways to record something about a place.

A vector is a shape with corners: a parcel boundary, a road centerline, a point
where a sensor sits. It is exact, and small as long as the shapes are simple.

A raster is a grid of cells, each holding one number, the way a photograph is a
grid of pixels. Air quality models and satellite land cover arrive this way. A
raster is uniform and easy to do arithmetic on, and it is large. Clark County at
30-metre resolution is roughly 22 million cells.

Zoning is vector. Air quality is raster. Neither converts to the other without
losing something, which is why a pipeline exists at all.

### Features, attributes, join keys

A feature is one thing that has both a shape and a set of facts. A parcel is a
feature: its shape is its boundary, its facts are its assessed value, its land
use code, its acreage.

Those facts are attributes — named columns, the same as a spreadsheet. A
geospatial dataset is a spreadsheet where one column happens to hold a shape.

A join key is the shared identifier that matches a row of numbers to a shape.
The Census calls its key a GEOID, and its digits encode the hierarchy:
`32003005810` is state 32, county 003, tract 005810. A join key is what lets
population downloaded from one agency attach to boundaries downloaded from
another.

### Formats

| Format       | What it is                                                                                                                                                                                        | Where it appears                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Shapefile    | The 1990s government standard. Three to six files that travel together, with column names capped at ten characters, which is why real data carries fields named `ASSDLNDVAL`.                     | Nearly every county download                        |
| GeoJSON      | Features as plain text. Every tool reads it. Enormous on the wire: 800,000 parcels exceeds a gigabyte.                                                                                            | APIs, extracts, this app's own internals            |
| CSV          | A spreadsheet with no shapes. A join key and numbers.                                                                                                                                             | Census tables, jobs data, most statistical releases |
| GeoTIFF      | A raster carrying its own position.                                                                                                                                                               | Land cover, modelled pollution                      |
| Vector tiles | The world pre-sliced into a pyramid of squares, one set per zoom level, each holding only what is visible there, simplified and compressed. The reason 800,000 parcels can be drawn in a browser. | Generated here                                      |
| PMTiles      | Every one of those tiles inside a single file with an index at the front, so a browser requests a byte range and receives one tile. No tile server and no database, only a file in storage.       | Hosted here                                         |

### Projections

The earth is round and screens are flat, so every dataset picks a way to flatten
it — a coordinate reference system. Clark County publishes in Nevada State Plane
East, measured in feet, because that is what surveyors use. Web maps want WGS84,
measured in degrees.

Both look plausible. `(2700000, 27000000)` is a sound State Plane position and a
nonsensical longitude. Reprojection is the first transformation in the pipeline
and the one most likely to fail without saying so, which is why it gets an
assertion rather than an assumption.

### Census geography

Nested, smallest first: block, block group, tract, county, state. Blocks are
finest, but most useful statistics are not published on them, because the sample
is too small and it would identify people. Block groups, at 600 to 3,000 people,
are the practical floor for income, commute mode, and vehicle ownership.

Two traps follow. Boundaries change every ten years, so a 2015 figure and a 2024
figure are not always about the same ground. And block groups vary enormously in
physical size, which is why a map of raw counts misleads and a map of density
does not.

### Choropleths

A choropleth shades areas by a value. It is the default for this whole feature,
and it fails in two documented ways.

Large areas look important because they are large. One desert block group can
outweigh downtown on screen. Normalization is the answer: value or density per
acre, never a total.

Classification — cutting a continuous range into colour bands — changes the
story. Equal-interval, quantile, and natural-breaks maps of one dataset tell
three different stories, and all three are defensible. The choice is editorial.
It is declared in the manifest, named in the legend, and computed once across a
whole region so that colours hold still while someone pans.

---

## Part 2 — Sources

Every endpoint here was checked live on 2026-08-08 for status, size,
modification date, and record count. Several widely cited URLs are dead or stale
while still answering with HTTP 200.

### The first set

| Layer                                 | Publisher                               | Unit                    | Volume                      | Vintage     | Licence         |
| ------------------------------------- | --------------------------------------- | ----------------------- | --------------------------- | ----------- | --------------- |
| Parcel shapes                         | Clark County GISMO                      | parcel                  | 950,464                     | live        | disclaimer only |
| Assessed value, land use, year built  | City of Las Vegas                       | parcel row, no geometry | 865,630                     | FY2027 roll | disclaimer only |
| Zoning, five jurisdictions            | Clark County combined service           | district                | ~8,000                      | current     | disclaimer only |
| Population, income, vehicles, commute | Census ACS 5-year with TIGER boundaries | block group             | ~1,500 in Clark             | 2024        | public domain   |
| Jobs at workplace and residence       | Census LEHD LODES 8                     | census block            | 353 KB to 6.4 MB compressed | 2023        | public domain   |
| Pollution                             | EJScreen, Harvard Dataverse archive     | block group             | 417 MB national             | 2024        | CC0             |

National land cover is a clean addition whenever the raster path earns its
build.

### Four findings that shaped the design

**Land value is a join, not a download.** Clark County publishes parcel shapes.
The City of Las Vegas republishes the Assessor's values as a table with no
geometry. They join on the parcel number. The counts differ — 950,464 shapes
against 865,630 value rows — so roughly 85,000 parcels have a shape and no
value. That is not a defect to repair. It is the case the absence rule exists
for, and it is visible on the first day the layer ships.

**The value table carries owner names and mailing addresses.** Publishing those
as browsable tiles would turn a planning tool into a people-search engine. The
conform stage reduces columns to a declared allowlist, so the omission is a
stated schema that a reviewer can read rather than a filter someone remembered
to apply.

**Zoning has five vocabularies in one metropolitan area and no bridge between
them.** Clark County, Las Vegas, North Las Vegas, Henderson, and Boulder City
each name their zoning fields differently and each mean different things by
similar codes. Part 3 covers what that implies nationally.

**Free data is not durable data.** EJScreen was withdrawn from EPA in February
2025 and survives because volunteers archived it under CC0. The Assessor sells
the extract that the City of Las Vegas gives away. Either could stop. So the
fetch stage writes a copy of every source into storage the project controls,
with its checksum and retrieval date. That is not caching. It is the difference
between a build that reproduces and a build that once worked.

### Excluded, and why

| Source                               | Reason                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| PurpleAir                            | The licence allows distribution one level removed only, and forbids reselling the data or an API derived from it. |
| National Zoning Atlas                | No open licence and no bulk download. Available by agreement.                                                     |
| AirNow                               | The terms state the data must not support public decision-making. A planning tool is decision support.            |
| Transit realtime for Southern Nevada | Served by a vendor under the vendor's licence, behind a key.                                                      |
| Nevada traffic counts                | No public service exposes them. This resolves through a person at the transportation department or not at all.    |

### Endpoints and fields

Verified live on 2026-08-08. Recorded here because the verification is the
point: several widely cited URLs answer HTTP 200 with dead or stale content, and
a reader who takes the obvious one loses a day.

| What                           | Endpoint                                                                                       | Fields that matter                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parcel shapes, 950,464         | `maps.clarkcountynv.gov/arcgis/rest/services/GISMO/AssessorMapv2/MapServer/1`                  | `APN`, `CALC_ACRES`, `PARCELTYPE`. Geometry only. Paginate: `maxRecordCount` is 2000.                                                                                                   |
| Assessed values, 865,630       | `services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/AOExtract_New/FeatureServer/10`    | `PARCEL` (join key), `LANDVAL`, `IMPVAL`, `TOTVAL`, `LYLANDVAL`, `LANDUSE`, `CONSTYR`, `LANDACRES`, `CAPACITY`, `SALEPRICE`, `SALEDATE`. Drop `OWNER`, `OWNER2`, and the mailing block. |
| Zoning, five jurisdictions     | `maps.clarkcountynv.gov/arcgis/rest/services/OpenData/PlanningandZoning/MapServer` layers 7–16 | Las Vegas `ZONE`; Boulder City `zone_class`; Henderson `ZONECODE`, `DENSITY`; North Las Vegas `ZONING`, `ZONEDESC`; Clark County `ZNCLASS`, `MLL_ZNCLASS`, `SUBTYP`                     |
| Zoning, parcel-level Las Vegas | `services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/Zoning_Open/FeatureServer/0`       | `PARCEL`, `ZONE`, `UDC_ZONE`, `USE_1`–`USE_10`, `VAR_1`–`VAR_5`. Approved special uses and variances per parcel, rarely available elsewhere.                                            |
| Census ACS 5-year              | `api.census.gov/data/2024/acs/acs5`                                                            | `B01003_001E` population, `B19013_001E` median income, `B08201` vehicles available, `B08301` commute mode, `B08303` travel time, `B25070` rent burden                                   |
| Census boundaries              | `www2.census.gov/geo/tiger/TIGER2025/BG/tl_2025_32_bg.zip`                                     | 4.9 MB block groups for Nevada. Swap `BG` for `TRACT`, `TABBLOCK20`, `PLACE`.                                                                                                           |
| Jobs                           | `lehd.ces.census.gov/data/lodes/LODES8/nv/`                                                    | `wac`, `rac`, `od`. Use `JT01` (primary jobs), not `JT00`, which double-counts multi-job holders. `SE01`–`SE03` split by earnings for value-of-time.                                    |
| Pollution                      | Harvard Dataverse `doi:10.7910/DVN/RLR5AX`                                                     | `EJSCREEN_2024_BG_*.csv`, 417 MB. `PM25`, `OZONE`, `DSLPM`, `PTRAF`, `NO2`, `PRE1960PCT`                                                                                                |
| Land cover _(deferred)_        | `www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2024_CU_C1V1.zip`  | 1.44 GB CONUS. Clip through the MRLC viewer rather than pulling whole.                                                                                                                  |
| Stop-level ridership           | `webgis.rtcsnv.com/arcgis/rest/services/Web/HUB/FeatureServer` layers 23–26                    | `BoardingsperWeekday`, `AlightingsperWeekday`, `WeekdayBoardingsperTrip`, and Saturday/Sunday equivalents. 3,767 stops, four seasonal snapshots.                                        |

Three traps in the above. The Census API requires a key and answers a keyless
request with an HTML page under HTTP 200. EPA's location database is keyed to
2010 block groups while ACS 2024 and TIGER 2025 use 2020 boundaries, so joining
them without a crosswalk drops rows silently. And the transit feed URL cited
across most public documentation, `rtcws.rtcsnv.com/g/google_transit.zip`, still
returns a valid archive whose service ended in March 2024; the Worker already
proxies the current one at `developer.rtcsnv.com`, and that is worth knowing
before somebody "corrects" it.

### Share-alike

OpenStreetMap, Overture, and Microsoft's building footprints are all ODbL. A
rendered raster tile is generally a produced work and carries only an
attribution duty. A vector tile carrying ODbL-derived attributes behaves much
more like an extract of the database, and share-alike may attach. This is
unsettled, and it is the one question here worth a lawyer's time.

The response is cheap now and expensive later. Every dataset declares its
licence in the manifest, so a build can exclude share-alike sources and emit a
clean region without a code change. Clark County's own street centerline
substitutes for OpenStreetMap roads. Building footprints have no clean-licensed
countywide alternative, which is why they are absent from the first set.

---

## Part 3 — Reaching every city

The obvious objection to Part 2 is that it lists one county's URLs. This section
answers where that generalizes and where it does not.

### Most of the value is already national

Census tables and boundaries, jobs data, pollution, land cover, and EPA's
location database are single national files with a uniform schema keyed by
GEOID. Build them once and every US city has population, income, vehicle access,
commute mode, jobs, and pollution from the day this ships. There is no per-city
work in any of them.

Land cover belongs to that group by shape but not by schedule: it is raster
rather than vector, and the first release builds no raster path, so it waits.
Everything else in the list is vector or a plain table.

That floor is higher than it looks. It is most of what the established transit
sketching tools sell. Only parcels and zoning are genuinely per-jurisdiction.

The distinction decides hosting cost. National coverage at block group grade is
roughly 240,000 features, which is nothing. National coverage at parcel grade is
on the order of 150 million polygons, which is not. So national layers stay
always-on at block group grade, and parcel-grade layers build per curated
region.

### Local data varies by city, not by format

Three thousand counties do not have three thousand formats. US municipal GIS
runs on a handful of platforms, and each one describes itself.

| Platform              | How it describes itself                                                            | Reach                                            |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| Esri ArcGIS services  | A metadata request returns every field name, type, alias, record count, and extent | Dominant. All five Las Vegas-area jurisdictions. |
| Socrata               | A metadata endpoint per view                                                       | State portals                                    |
| CKAN                  | A package search API                                                               | Federal and state portals                        |
| Direct file over HTTP | A HEAD request and the file's own header                                           | County bulk downloads                            |
| Statistical APIs      | Documented and parameterized                                                       | Census products                                  |
| OGC services          | A capabilities document                                                            | Uncommon in the US, common in Europe             |

So the pipeline carries an adapter per platform rather than per city — roughly
six of them, covering most of the country. Adding a city becomes a manifest
entry naming the platform, the endpoint, and a mapping. The mechanical half of
onboarding a city costs almost nothing.

### The half that costs something

Two problems remain and both are about meaning rather than structure.

Which column holds assessed land value? It appears as `LANDVAL`, `LAND_VAL`,
`ASSDLND`, `AV_LAND`, and dozens of other spellings.

What does a code mean? `R-3` in one city and `RM-16` in the next may or may not
describe the same thing.

This is the work the National Zoning Atlas completed for all thirty-five Nevada
jurisdictions and then chose not to publish openly. It is why no open,
normalized, national land use dataset exists.

It is also a language task over metadata: field names, human-readable
descriptions, and sample values, mapped to a fixed target schema. There are on
the order of two thousand distinct zoning codes nationally, not millions of
rows. That is small enough for a model to propose against and a person to
review.

### The harvester

Six stages. Two are deterministic, one is a model, and the last three are why
the result can be trusted.

1. **Discover.** Query the platform's own catalog for datasets whose title,
   tags, or fields suggest zoning, parcels, or land use.
2. **Profile.** Pull the field schema, record count, extent, and a sample of
   rows. Deterministic, and no model is involved.
3. **Propose.** A model reads the profile and returns a candidate mapping as
   structured output: which field carries the code, which carries the
   description, and a table from code to normalized class with a confidence and
   a one-line rationale for each row.
4. **Evidence.** Render what a person needs to judge the proposal: distinct
   codes with counts, sample descriptions, acreage per proposed class, and a
   thumbnail of the layer coloured by the mapping. A wrong mapping is usually
   obvious in the thumbnail.
5. **Review.** A person accepts, edits, or rejects. Nothing publishes unreviewed.
   The decision commits as a crosswalk file: plain data, diffable, attributable.
6. **Regress.** On the next vintage, profile again. Codes already in the
   crosswalk pass through untouched. A new or changed code is reported as
   unmapped and fails the build.

Stage six is what makes the rest safe. The roadmap already carries the rule that
an importer must not guess a mode, and a model is very good at guessing. Here
the model proposes and never decides, and a decision once made becomes data
rather than something re-derived.

The economics follow. Human judgement is spent once per code rather than once
per rebuild, and the corpus improves in one direction only. It is also the
durable part: the pipeline is a month of work to copy, and a reviewed national
crosswalk is not.

### Publishing the result

The harvester's output is the dataset that does not currently exist in the open:
normalized zoning and land value across US jurisdictions, each row carrying its
provenance and its source's licence.

Three commitments follow from what this project already is.

The corpus and the pipeline stay open, matching the repository's licence.
Crosswalks are the contribution surface, and a planner who knows their own city
can correct one row to everyone's benefit.

The tiles stay free to read. What genuinely costs money is keeping thousands of
jurisdictions current, watching for schema drift, and running the review queue.
Sustaining that work is a separate question from closing the data, and this
design does not close the data.

The result stands on its merits. The comparable products are enterprise-priced
and closed, or open and limited to transit feeds plus census tables. An open,
normalized, national zoning and land value layer has no incumbent.

Schema drift is a scheduled job rather than an incident. Known sources are
profiled again on a cycle and the schema compared. A renamed column or a
withdrawn endpoint opens an issue instead of quietly producing a blank map.
EJScreen vanished outright and the most-cited building footprint URL now refuses
public access, so this is not a hypothetical failure.

One limit is worth stating. The harvester makes onboarding cheap, not free.
Some data is not online in any form: Nevada's traffic counts live in PDF
reports, and the state's own servers expose no service for them. A manifest
should record that a layer is unavailable rather than implying the pipeline
could have found it.

---

## Part 4 — The pipeline

### Stages

1. **Fetch and archive.** Retrieve, and write a copy into storage the project
   controls with its checksum and retrieval date. Nothing is fetched at runtime.
2. **Conform.** Reproject to WGS84, repair invalid geometry, and reduce columns
   to the declared allowlist. Assert the resulting bounding box falls inside the
   region's declared extent, which is the reprojection check.
3. **Join.** Attach tables without geometry to their shapes on the declared key
   and record the match rate. The unmatched count is published rather than
   discovered later by someone wondering why part of a valley is blank.
4. **Reconcile.** Apply the reviewed crosswalk. An unmapped code fails the
   build. It is never collected into an "other" bucket.
5. **Derive.** Compute the measures that are not raw columns: value per acre,
   people per acre, share of households without a vehicle.
6. **Bin.** Allocate onto a hexagonal grid, weighted by area. Built now,
   unpublished in the first release, so that later analysis needs no second
   pipeline.
7. **Classify.** Compute break points once across the region by the declared
   method and write them into the manifest, which makes the legend a fact about
   the dataset rather than a function of the viewport.
8. **Split.** Separate geometry from values.
9. **Pack.** Write tiles for geometry and attribute packs for values, each named
   by content hash so both are immutable and cacheable indefinitely.
10. **Publish.** Upload and write the manifest. Each dataset's licence travels
    with it, so a build can exclude every share-alike source without a code
    change.

Credentials stay in the build. The Census API requires a key and answers a
keyless request with an HTML page under HTTP 200, which breaks a JSON parser
instead of reporting an authentication failure. Precomputing keeps that key out
of the browser entirely.

### Separating shape from value

Tiles carry shapes and an identifier. Values live in a separate small file that
maps identifiers to numbers.

A browser downloads a region's shapes once. Switching the map from assessed land
value to population density then fetches tens of kilobytes of numbers and
repaints, and no polygon is downloaded twice. The map library supports this
through feature state, and this codebase already drives selection and hover the
same way, so the pattern is established rather than new.

The consequence that matters is not speed. A modelled value is produced in the
same form as a measured one: an identifier and a number. The renderer cannot
tell them apart. That single property is what makes accessibility, uplift, and
return on investment additions to this design rather than replacements for it.

### Serving

The project runs inside a free tier with a hard daily request ceiling, and
panning a map generates tile requests by the hundred. Routing tiles through the
Worker would spend a day's allowance in minutes.

So tiles are served from a public object store on its own domain. Object storage
answers HTTP range requests natively, which is what the tile format needs, and a
public read is a storage operation rather than a billed Worker invocation. No
new Worker route is required. The manifest names the base URL, so putting a
Worker in front later is a manifest change.

---

## Part 5 — The model

Five concepts, in vocabulary the project already uses.

| Concept   | What it is                                                        | Example                                      |
| --------- | ----------------------------------------------------------------- | -------------------------------------------- |
| Region    | A place data exists for, declared by one manifest                 | Clark County, Nevada                         |
| Dataset   | One published source with its provenance attached                 | Assessor parcels, 2025 roll                  |
| Measure   | One thing that can be mapped, with a unit and a type              | Assessed land value per acre                 |
| Geography | The shapes a measure is reported on                               | Parcels, block groups, tracts, hexes, raster |
| Lens      | A measure and how it is drawn. What a person picks, one at a time | Land value, shaded, quantile breaks, 2025    |

All of it is data rather than code, which is the first design principle. Adding
a dataset is a manifest entry, and no branch anywhere reads a dataset
identifier. Colour ramps live with the other style catalogs and never in the
model, which is the second.

None of it enters the transit system document. Land use data is not
user-authored, so a saved or shared system never carries it and it never enters
undo history. The document version does not move and the serializer is
untouched.

---

## Part 6 — The interface

### Choosing a lens

The shell renders before any of this resolves, unchanged.

The layers control's reference column, which today holds one landmark checkbox,
grows a list: none, zoning, land value, people, jobs, pollution. It is a radio
group rather than checkboxes, and it is the only such control there. Two
choropleths cannot be read at once, because the second destroys the first. That
reason belongs in a comment beside the code.

Choosing land value desaturates the basemap, shades parcels from pale to deep,
and thickens the casing on the reader's own lines so the proposal stays the
subject and the data stays the background. A red line over a red-orange
choropleth is invisible, which is a real failure rather than a theoretical one.

### The legend is a control

A lens without a legend is decoration. The card that appears is not a passive
key.

Its title names the measure and its vintage. Selecting the title switches
measure, or switches between the vintages the pipeline actually fetched — a
short list of published years, not a scrubbable timeline, and nothing modelled.
Selecting a colour class filters the map to it. The source line opens
provenance: publisher, retrieval date, licence, and the classification method
that produced the breaks.

That last item is not decoration either. An advocate presenting to a council
member has to answer where a number came from without leaving the map.

### Every dataset answers at once

Selecting a point reports every measure known at that location rather than only
the shaded one: zoning, land value, people, vehicle access, pollution, in one
list. It belongs in the inspector, which keeps one dynamic surface, and it makes
each loaded dataset useful while only one of them is shaded.

### Absence is stated

Roughly 85,000 parcels in Clark County have a shape and no assessed value. They
draw as an explicit hatch, named in the legend with its count. Never as zero,
and never as a dialog to dismiss. Shading them zero would draw a band of
worthless land across the valley that does not exist.

The rule scales. Opened over a city with no local coverage, the reference list
still offers people, jobs, and pollution, because those are national. Zoning and
land value appear disabled, reading that they are unavailable here, beside a
link explaining how a region is added. Not an empty map and not an error: a
stated absence with a way forward, which is the invalid-state principle applied
to missing data.

### Sharing

The active lens is view state, following the landmark toggle's precedent. It is
presentation rather than part of the transit system, and it encodes into the
share URL so a shared link opens on land value without touching the document
schema. Export and embed both render it, because a shaded map in a blog post is
most of the advocacy payoff.

Diagram view turns lenses off. That view is schematic and its geography is not
real.

---

## Part 7 — What this enables, and what it refuses

The simulator is resolved rather than stepping: a pure function of the instant,
holding no memory. Land use analysis matches it. A value for a cell in a year is
a pure function of its baseline, the network's accessibility, and the years
since opening. Scrubbing a year then costs what advancing a frame costs, and
none of it needs a browser to test.

Four things become reachable, in order of how much they claim.

**Accessibility.** Jobs reachable within a travel-time budget on the network the
reader drew, computed from jobs per cell. A defensible number, and only another
measure, produced locally instead of fetched.

**Observed change.** Assessed value a decade apart along corridors that already
exist. Evidence containing no model at all, and the most credible thing this
tool could show.

**Land-value uplift.** A published elasticity applied to a change in
accessibility, presented as a wide and clearly labelled range. The capital cost
estimator already sets that standard and is the one to copy.

**Return on investment.** Uplift set against capital and operating cost.

Agent-based simulation stays out. A resolved architecture cannot express
path-dependent behaviour, the simulation document says so, and adopting it would
be the change that document already anticipates rather than an extension of this
one.

### What comparable tools do, and what Las Vegas breaks

The closest comparable sketching tool runs on this same stack — jobs data for
home and workplace, census boundaries, a distance-decay gravity model — with
three details worth taking. It calibrates the decay for each city against that
city's real distribution of commute distances rather than using one global
parameter. It varies value of time by income within a neighbourhood, which is
what makes ridership respond gradually to a network change instead of switching
at a threshold. And it treats large non-commute generators separately: airports
and universities, each with their own income and departure-time distributions.

Both of those special cases apply here, because the airport and the university
are among the valley's largest generators. A third has no equivalent in the
reference implementation. The Strip's shift-work hospitality employment breaks
the nine-to-five departure distribution badly, and the federal jobs data
understates it, because that data sees only jobs inside unemployment-insurance
wage records and this labour market is unusually tipped, gig, and informal. Any
ridership figure produced here needs a generator specific to the Strip and a
statement that the baseline runs low.

Which is the argument for ingesting the transit agency's stop-level boardings
early. It publishes four seasonal snapshots covering every stop in the valley,
with weekday, Saturday, and Sunday counts. A model checked against thousands of
observed stops survives a planning meeting. A model checked against nothing does
not.

---

## Part 8 — Placement and constraints

The subsystem divides along the split the project already keeps. Rules about
what land use data is — parsing a manifest, validating it, classifying,
joining, and later binning and accessibility — are pure and belong with the
domain. Fetching, caching, lens state, layer specifications, and the legend
belong to the application. The acquisition pipeline is build tooling that never
reaches a browser, and the reviewed crosswalk corpus is data with no code in it.

Constraints that silently break something when missed. Each names the code that
enforces it, because a reader who hits one of these needs the file, not the
principle.

- **Every source and layer id must start with `tm-`.** `carryTransitMapperStyle`
  in `apps/web/src/map/styleSwitchController.ts` copies forward only `tm-*`
  entries across a light/dark switch and drops the rest.
- **`recoverMapStyleState` in `apps/web/src/map/styleRecovery.ts` needs a restore
  hook**, alongside the existing `restoreLandmarkVisibility()`, or a lens turns
  itself off whenever the style reloads.
- **Paint order is array order** in `createLayerSpecs()`
  (`apps/web/src/map/layers/layerSpecs.ts`). Lens layers go at the bottom of that
  array, at or before `LYR_LANDMARKS`. `ensureOverlay` anchors by `beforeId` when
  it heals, so the array is the source of truth.
- **Lens sources follow `SRC_LANDMARKS`, not `ALL_SOURCES`.** Landmarks sit
  outside the system-derived upload plan in `apps/web/src/map/MapCanvas.tsx`
  because they are static context set once. Lens sources are the same shape.
- **Toggle with `setLayoutProperty`, not a feature rebuild.** The landmark
  visibility effect is deliberately separate from the view effect, because
  toggling there ran a full synchronous rebuild that produced byte-identical
  data.
- **`packages/core` may not touch browser globals**, has a dependency allowlist
  enforced by `dependency-cruiser.config.mjs` and the `core-runtime-purity` lint
  rule, and carries a coverage floor. Fetching belongs in `apps/web`;
  classification and joins belong in core.
- **A new `src/<dir>` needs a `####` section** in
  [Project structure](../../development/reference/project-structure.md) under its
  owning package, and a new workspace package must declare `lint`, `typecheck`,
  and `verify`, before `check:structure` and `check:contract` pass.
- **New module filenames are kebab-case** (`check:filenames`).

Two documents fall out of date when code lands rather than now. The
architecture's scope section rules out ridership modelling and will need
revision when analysis ships; it excludes planned work by its own rules, so it
does not change in advance. The structure reference fails on a documented path
that does not exist, so its entries arrive with the directories they describe.

---

## Risks

| Risk                                                   | Why it matters                                                                             | Response                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The crosswalk is both the product and the hardest part | If harvesting fails, this is a single-county feature wearing a national costume            | Prove it against the five Las Vegas-area jurisdictions first. They already disagree five ways. A harvester that cannot handle one metropolitan area cannot handle a country. |
| A model proposing mappings will be confidently wrong   | A plausible bad crosswalk is worse than a missing one, because nothing looks broken        | Nothing publishes unreviewed, evidence rendering makes errors visible, and an unseen code fails the build rather than defaulting                                             |
| The free route to land value is a republication        | One agency sells what another gives away, and the free copy can be withdrawn               | Archive on ingest. Confirm terms in writing before the layer becomes load-bearing.                                                                                           |
| Share-alike and vector tiles                           | Unsettled, and isolating licences afterwards is expensive                                  | Declare a licence per dataset now, keep building footprints out of the first set, take advice before shipping one                                                            |
| The location database uses 2010 boundaries             | Joining it to current boundaries drops and misassigns rows, worst where growth was fastest | Defer it until a boundary crosswalk exists. A partial join must not look like a complete map.                                                                                |
| Parcel-grade national coverage is large                | 150 million polygons is not a free-tier hosting story                                      | National layers stay block-group grade; parcel grade builds per curated region                                                                                               |
| The manifest is a public contract                      | Pluggable means third parties write manifests this app must keep reading                   | Version the format from the first release and refuse an unknown version rather than guessing                                                                                 |

## Sequencing

Two projects, buildable independently, each with its own implementation plan.
The display system ships against hand-built data for one county. The harvester
and corpus have value even if no map renders them. Building the display system
first gives the harvester somewhere to publish.

Two things start before any code, because neither is on the critical path and
both are slow: a harvester trial against the five Las Vegas-area zoning layers,
which is the smallest honest test of the national claim, and the conversation
with the state transportation department about traffic counts, whose reply time
nobody here controls.
