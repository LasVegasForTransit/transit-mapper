# Transit data types

> **Status:** Target reference as of 2026-08-28. These names describe the
> approved architecture. They do not claim that production exports these
> interfaces yet.

This reference is for contributors who define core types, adapters, storage,
APIs, or renderer inputs. Use it to place each new type in the correct family
and reject dependencies that point upward. It defines the type families and
dependency rules for the target
[transit content architecture](2026-08-28-transit-content-architecture.md).

## Storage roots

| Type             | Contents                                                       | Excludes                                                       |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `TransitSystem`  | One editable network and its authored transit facts            | Live provider feeds, broad dataset indexes, renderer state     |
| `Source`         | Stable external-series identity, attribution, and capabilities | Captured bytes, normalized network facts, credentials          |
| `TransitDataset` | A normalized source-backed collection and its revision history | Editor state, MapLibre state, geographic product modes         |
| `View`           | A content reference, network query, and map presentation       | Transit records, focus, permissions, chrome, rendered features |

These four records are the only product-level storage roots in this design.
Other persisted records belong to one of them or support their revision
history.

## Supporting records

| Type                      | Owner            | Meaning                                                               |
| ------------------------- | ---------------- | --------------------------------------------------------------------- |
| `SystemRevision`          | `TransitSystem`  | One immutable authored snapshot used by publishing and pinned Views   |
| `SourceRevision`          | `Source`         | One immutable acquisition with digest, version, times, and validity   |
| `SourceFactArtifact`      | Source revision  | Recoverable planned facts or incremental changes with Source snapshot |
| `DatasetRevision`         | `TransitDataset` | One immutable normalized network built from exact Source revisions    |
| `DatasetNetworkArtifact`  | Dataset revision | Recoverable canonical network and complete provenance graph           |
| `OperationalSnapshot`     | Dataset revision | Time-stamped normalized changes from exact Source revisions           |
| `OperationalFactArtifact` | Source revision  | Recoverable provider-neutral realtime claims                          |
| `DatasetCacheManifest`    | Dataset revision | Rebuildable bounded query index and delivery chunks                   |
| `ExternalRef`             | Provenance       | Provider-neutral source, record kind, and external identifier         |
| `DatasetProvenance`       | Dataset revision | Normalized entities mapped to exact external facts and derivations    |
| `SourceBinding`           | Imported system  | Active external identity mapped to one authored target                |
| `ImportHistoryEntry`      | Imported system  | Provenance for one accepted import without granting update authority  |
| `LegacyServiceAlias`      | Migrated system  | One v16 Service mapped to its Line, ServicePlan, and Patterns         |
| `LegacySourceReference`   | Migrated system  | Opaque v16 import marker with no reconciliation authority             |

`SourceRevision` and `DatasetRevision` use separate identifiers. A byte digest
identifies captured content. A publisher version describes provider intent.
Service validity states when the content applies. None of those values can
stand in for the others.

Source, publisher, Agency, and Operator identities remain separate. One
publisher may publish several Sources. One Source may contain several
Agencies. An Agency may represent a rider-facing brand instead of the company
that operates each trip.

An immutable authored revision uses this contract:

```ts
interface SystemRevision {
  id: string;
  systemId: string;
  createdAt: string;
  schemaVersion: 17;
  contentDigest: ContentDigest;
  system: TransitSystem;
}
```

`SystemRevision.contentDigest` is the SHA-256 digest of the canonical value
bytes for `{ encodingVersion: 'transit-system-json-v1', schemaVersion: 17,
system }`. The authored document's meaningful arrays retain their stored order.
The repository rejects a document that is not canonical under the schema-v17
parser before hashing it. The revision ID is the lowercase SHA-256 digest of
`frame(['system-revision-v1', systemId, contentDigest.algorithm,
contentDigest.value])`. `createdAt` does not enter either digest. Publishing
the same semantic document twice returns the existing immutable revision and
its original creation time. A legacy backfill uses the same formula after the
shared v16-to-v17 migration, so a retry produces the same revision ID.

## Shared source and geography values

These values support Sources, revisions, queries, and Views. They are not new
storage roots.

```ts
interface PublisherRef {
  id: string;
  name: string;
  url?: string;
}

interface Attribution {
  text: string;
  url?: string;
}

interface LicenseRef {
  id: string;
  name: string;
  url?: string;
}

type SourceFormatId = 'gtfs-schedule' | 'gtfs-realtime' | 'openstreetmap';

interface SourceFormatRef {
  id: SourceFormatId;
  profile?: string;
}

type SourceCapability =
  | 'planned-network'
  | 'planned-schedule'
  | 'alignments'
  | 'physical-infrastructure'
  | 'structured-operations'
  | 'advisories';

interface SourceCapabilities {
  claims: readonly SourceCapability[];
}

type IdentityStability = 'source-stable' | 'revision-local';

type SourceRelationship = { kind: 'updates'; sourceId: string };

interface ContentDigest {
  algorithm: 'sha-256';
  value: string;
}

interface ArtifactDescriptor {
  digest: ContentDigest;
  mediaType: string;
  byteLength: number;
}

interface UpstreamValidators {
  etag?: string;
  lastModified?: string;
}

interface ValidationIssue {
  code: string;
  message: string;
  path?: readonly (string | number)[];
}

type RevisionValidation =
  | {
      kind: 'accepted';
      validatedAt: string;
      warnings: readonly ValidationIssue[];
    }
  | {
      kind: 'rejected';
      validatedAt: string;
      errors: readonly [ValidationIssue, ...ValidationIssue[]];
      warnings: readonly ValidationIssue[];
    };

type RevisionCompleteness =
  { kind: 'full' } | { kind: 'incremental'; baseRevisionId: string } | { kind: 'unknown' };

type AcceptedRevisionValidation = Extract<RevisionValidation, { kind: 'accepted' }>;

type Applicability<Value> =
  { kind: 'all' } | { kind: 'only'; values: readonly [Value, ...Value[]] } | { kind: 'unknown' };

type LngLat = readonly [longitude: number, latitude: number];

type GeographicBounds =
  | { kind: 'ordinary'; west: number; south: number; east: number; north: number }
  | {
      kind: 'crosses-antimeridian';
      west: number;
      south: number;
      east: number;
      north: number;
    };

interface GeographicPolygon {
  outer: readonly [LngLat, LngLat, LngLat, LngLat, ...LngLat[]];
  holes: readonly (readonly [LngLat, LngLat, LngLat, LngLat, ...LngLat[]])[];
}

type GeographicCoverage =
  | { kind: 'unknown' }
  | {
      kind: 'known';
      polygons: readonly [GeographicPolygon, ...GeographicPolygon[]];
    };

type Grade = 'underground' | 'atGrade' | 'elevated';
type LegDirection = 'forward' | 'reverse';
type LineGeometry = 'straight' | 'curved' | 'freeform';
type LegLane = { kind: 'auto' } | { kind: 'pinned'; laneId: string };

interface LegExtent {
  start: number;
  end: number;
}

type LaneDirection = 'forward' | 'reverse' | 'both' | 'none';

interface LaneSpec {
  id: string;
  kindId: string;
  widthMeters: number;
  direction: LaneDirection;
}

interface CrossSection {
  lanes: readonly LaneSpec[];
}

interface CurveControl {
  pointIndex: number;
  radiusMeters: number;
}

type TransitCarrierRef =
  { kind: 'alignment'; id: string } | { kind: 'way'; id: string; laneId?: string };

type TransitEntityRef =
  | { kind: 'publisher'; id: string }
  | { kind: 'agency'; id: string }
  | { kind: 'operator'; id: string }
  | { kind: 'alignment'; id: string }
  | { kind: 'way'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'service-plan'; id: string }
  | { kind: 'pattern'; id: string }
  | { kind: 'schedule'; id: string }
  | { kind: 'calendar'; id: string }
  | { kind: 'trip'; id: string }
  | { kind: 'frequency-rule'; id: string }
  | { kind: 'operational-change'; id: string }
  | { kind: 'advisory'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'named-way'; id: string }
  | { kind: 'median'; id: string }
  | { kind: 'lane-connector'; id: string }
  | { kind: 'turn-restriction'; id: string }
  | { kind: 'approach-control'; id: string };

type DatasetProvenanceTarget =
  | TransitEntityRef
  | { kind: 'line-service-plan-link'; id: string }
  | { kind: 'service-plan-pattern-link'; id: string };

interface InstantRange {
  start: string;
  end: string;
}

interface LocalizedAdvisoryText {
  language?: string;
  header?: string;
  description: string;
  url?: string;
}
```

Runtime parsers reject blank IDs and text, SHA-256 values that are not 64
lowercase hexadecimal digits, negative byte lengths, invalid media types and
timestamps, duplicate or unsorted capability IDs, and non-HTTP(S) publisher,
attribution, or license URLs. Bounds parsers enforce finite coordinates,
latitude and longitude ranges, ordinary west-to-east order, and wrapped
antimeridian order. Coverage parsers require closed rings and reject degenerate
polygons.
Leg extents use normalized arc-length positions from zero through one. Parsers
require a finite start and end, reject equal endpoints, and use `direction` to
state travel orientation instead of inferring it from coordinate order.

## Source and dataset records

The target Source records preserve identity and reproducibility without
storing connector secrets or provider-specific fields:

```ts
interface Source {
  id: string;
  name: string;
  format: SourceFormatRef;
  publisher?: PublisherRef;
  attribution: Attribution;
  license?: LicenseRef;
  capabilities: SourceCapabilities;
  relationships: readonly SourceRelationship[];
}

interface TransitDataset {
  id: string;
  name: string;
  description?: string;
  sourceIds: string[];
  buildPolicyId: string;
  latestRevisionId?: string;
}

interface SourceRevision {
  id: string;
  sourceId: string;
  artifact: ArtifactDescriptor;
  publisherVersion?: string;
  fetchedAt: string;
  publishedAt?: string;
  serviceValidity?: ServiceDateRange;
  upstreamValidators: UpstreamValidators;
  formatVersion?: string;
  adapterVersion: string;
  completeness: RevisionCompleteness;
  validation: RevisionValidation;
  capabilities: SourceCapabilities;
}

type AcceptedSourceRevision = SourceRevision & {
  validation: AcceptedRevisionValidation;
};

interface SourceCitation {
  sourceId: string;
  name: string;
  publisher?: PublisherRef;
  attribution: Attribution;
  license?: LicenseRef;
}
```

`ArtifactDescriptor` carries a content digest, media type, and byte length.
The storage adapter maps it to bytes. `UpstreamValidators` retains values such
as an ETag or last-modified time. Connector configuration owns endpoints,
credentials, polling, and retries.

A managed adapter host emits one nonempty provider-neutral envelope. The exact
Source and SourceRevision carry the metadata that the Dataset builder needs.
Every fact's `ExternalFactRef` must name that Source and revision. The adapter
itself emits provider-neutral fact values and adapter-local record references;
the host adds acquisition authority only after validation.

```ts
interface AdapterLocalRef {
  namespace: string;
  kind: string;
  id: string;
  stability: IdentityStability;
}

interface ExternalRef {
  sourceId: string;
  kind: string;
  id: string;
}

type ExternalRecordRef =
  | (ExternalRef & { stability: 'source-stable' })
  | (ExternalRef & {
      stability: 'revision-local';
      sourceRevisionId: string;
    });

type ExternalFactRef = ExternalRef & {
  sourceRevisionId: string;
  stability: IdentityStability;
};

interface UploadRef {
  uploadId: string;
  kind: string;
  id: string;
  stability: IdentityStability;
}

interface UploadFactRef extends UploadRef {
  artifactDigest: ContentDigest;
}
```

`ExternalRef` is the portable identity that a managed import may bind across
revisions. A host may derive it from `ExternalRecordRef` only when stability is
`source-stable`. Revision-local records remain valid provenance, but they
cannot grant update authority. An adapter declares stability per record. A
format name or the presence of an ID never implies stability.

The fact algebra uses separate occurrence and link parameters. Adapters emit
adapter-local occurrences and links. A managed host qualifies both with a
Source. A one-time host qualifies both with an upload identity.

```ts
interface Fact<Kind extends string, Occurrence, Value> {
  kind: Kind;
  external: Occurrence;
  value: Value;
}

type TransitFact<Occurrence, Link> =
  | Fact<'publisher', Occurrence, PublisherFact>
  | Fact<'agency', Occurrence, AgencyFact<Link>>
  | Fact<'operator', Occurrence, OperatorFact<Link>>
  | Fact<'line', Occurrence, LineFact<Link>>
  | Fact<'service-plan', Occurrence, ServicePlanFact<Link>>
  | Fact<'pattern', Occurrence, PatternFact<Link>>
  | Fact<'schedule', Occurrence, ScheduleFact<Link>>
  | Fact<'calendar', Occurrence, CalendarFact>
  | Fact<'trip', Occurrence, TripFact<Link>>
  | Fact<'frequency-rule', Occurrence, FrequencyRuleFact<Link>>
  | Fact<'stop', Occurrence, StopFact<Link>>
  | Fact<'station', Occurrence, StationFact>
  | Fact<'alignment', Occurrence, AlignmentFact>
  | Fact<'way', Occurrence, WayFact<Link>>
  | Fact<'node', Occurrence, NodeFact<Link>>
  | Fact<'named-way', Occurrence, NamedWayFact<Link>>
  | Fact<'median', Occurrence, MedianFact<Link>>
  | Fact<'lane-connector', Occurrence, LaneConnectorFact<Link>>
  | Fact<'turn-restriction', Occurrence, TurnRestrictionFact<Link>>
  | Fact<'approach-control', Occurrence, ApproachControlFact<Link>>
  | Fact<'facility', Occurrence, FacilityFact>
  | Fact<'group', Occurrence, GroupFact<Link>>;

type AdapterFact = TransitFact<AdapterLocalRef, AdapterLocalRef>;
type SourceFact = TransitFact<ExternalFactRef, ExternalRecordRef>;
type UploadFact = TransitFact<UploadFactRef, UploadRef>;

type AdapterFactMutation =
  { kind: 'upsert'; fact: AdapterFact } | { kind: 'delete'; target: AdapterLocalRef };

type AdapterFactBatch =
  | {
      kind: 'snapshot';
      facts: readonly [AdapterFact, ...AdapterFact[]];
    }
  | {
      kind: 'changes';
      changes: readonly [AdapterFactMutation, ...AdapterFactMutation[]];
    };

type PlannedAdapterResult =
  | {
      kind: 'accepted';
      validation: AcceptedRevisionValidation;
      batch: AdapterFactBatch;
    }
  | {
      kind: 'rejected';
      validation: Extract<RevisionValidation, { kind: 'rejected' }>;
    };

interface UploadFactBatch {
  uploadId: string;
  artifact: ArtifactDescriptor;
  facts: readonly [UploadFact, ...UploadFact[]];
}
```

The payloads carry semantic evidence rather than provider rows:

```ts
type KnownOrUnknown<Value> = { kind: 'known'; value: Value } | { kind: 'unknown' };

interface PublisherFact {
  name: string;
  url?: string;
}

interface AgencyFact<Link> {
  name: string;
  shortName?: string;
  timeZone: ServiceTimeZone;
}

interface OperatorFact<Link> {
  name: string;
  agencyRefs: readonly Link[];
}

interface LineFact<Link> {
  name?: string;
  publicCode?: string;
  color?: string;
  agencyRefs: readonly Link[];
  operatorRefs: readonly Link[];
  servicePlanRefs: readonly Link[];
}

interface ServicePlanFact<Link> {
  name?: string;
  mode: KnownOrUnknown<string>;
  vehicleKindId?: string;
  agencyRefs: readonly Link[];
  operatorRefs: readonly Link[];
  patternRefs: readonly Link[];
  scheduleRefs: readonly Link[];
}

interface FactPatternStopCall<Link> {
  id: string;
  stop: Link;
}

type FactPatternPath<Link> =
  | { kind: 'unknown' }
  | {
      kind: 'known';
      legs: readonly [FactPatternLeg<Link>, ...FactPatternLeg<Link>[]];
    };

interface FactPatternLegBase {
  direction: KnownOrUnknown<LegDirection>;
  extent: KnownOrUnknown<LegExtent>;
}

type FactPatternLeg<Link> =
  | (FactPatternLegBase & { kind: 'alignment'; alignment: Link })
  | (FactPatternLegBase & {
      kind: 'way';
      way: Link;
      laneId: KnownOrUnknown<string>;
    });

interface PatternFact<Link> {
  direction?: PatternDirection;
  path: FactPatternPath<Link>;
  stopCalls: readonly FactPatternStopCall<Link>[];
}

interface ScheduleFact<Link> {
  tripRefs: readonly Link[];
  frequencyRuleRefs: readonly Link[];
}

interface CalendarFact {
  timeZone: ServiceTimeZone;
  dateRange: ServiceDateRange;
  activeWeekdays: readonly Weekday[];
  exceptions: readonly CalendarException[];
}

interface TripFact<Link> {
  pattern: Link;
  calendar: Link;
  stopTimes: readonly ScheduledStopTime[];
}

interface FrequencyRuleFact<Link> {
  pattern: Link;
  calendar: Link;
  startTimeSeconds: number;
  endTimeSeconds: number;
  headwaySeconds: number;
  precision: 'exact' | 'headway' | 'unknown';
  templateStopTimes: readonly ScheduledStopTime[];
}

interface StopFact<Link> {
  name?: string;
  location: KnownOrUnknown<LngLat>;
  station?: Link;
  anchors: readonly { carrier: Link; position: number }[];
  major?: boolean;
}

interface StationFact {
  name?: string;
  location: KnownOrUnknown<LngLat>;
  footprint?: GeographicPolygon;
}

interface AlignmentFact {
  path: KnownOrUnknown<readonly [LngLat, LngLat, ...LngLat[]]>;
}

type PhysicalWayEvidence<Link> =
  | {
      kind: 'complete';
      alignment: Link;
      alignmentExtent: readonly [number, number];
      typeId: string;
      grade: Grade;
      profile: CrossSection;
      classId?: string;
    }
  | {
      kind: 'partial';
      alignment?: Link;
      alignmentExtent?: readonly [number, number];
      typeId?: string;
      grade?: Grade;
      profile?: CrossSection;
      classId?: string;
    };

interface WayFact<Link> {
  physical: PhysicalWayEvidence<Link>;
}

interface NodeFact<Link> {
  location: KnownOrUnknown<LngLat>;
  wayPoints: readonly { way: Link; pointIndex: number }[];
  controlId?: string;
}

interface NamedWayFact<Link> {
  name: string;
  ways: readonly [Link, ...Link[]];
}

interface MedianFact<Link> {
  namedWay: Link;
  widthMeters: number;
  kindId: string;
}

interface LaneConnectorFact<Link> {
  node: Link;
  from: { way: Link; laneId: string };
  to: { way: Link; laneId: string };
}

interface TurnRestrictionFact<Link> {
  fromWay: Link;
  toWay: Link;
  via: { kind: 'node'; node: Link } | { kind: 'ways'; ways: readonly [Link, ...Link[]] };
  movement: 'prohibited' | 'only';
  fromLaneIds: Applicability<string>;
  toLaneIds: Applicability<string>;
  modeIds: Applicability<string>;
}

interface ApproachControlFact<Link> {
  node: Link;
  way: Link;
  end: 'start' | 'end';
  controlId: string;
}

interface FacilityFact {
  typeId: string;
  name?: string;
  geometry: KnownOrUnknown<LngLat | GeographicPolygon>;
}

interface GroupFact<Link> {
  name?: string;
  members: readonly Link[];
  footprint?: GeographicPolygon;
  color?: string;
}
```

Only `PhysicalWayEvidence.kind === 'complete'` can normalize into a Way. A
partial claim remains evidence or contributes an Alignment. The normalizer
never fills a missing location, physical profile, grade, path, timezone, or
boarding rule from a provider convention. A partial `alignmentExtent` is legal
only beside its `alignment` link. It does not become a Way until the complete
claim owns both values.

An immutable fact artifact stores the exact portable Source snapshot with the
SourceRevision. Full and unknown revisions store a snapshot. Incremental
revisions store nonempty mutations against the declared base revision.

```ts
type SourceFactMutation =
  | { kind: 'upsert'; fact: SourceFact }
  | { kind: 'delete'; evidence: ExternalFactRef; target: ExternalRecordRef };

type SourceFactArtifact =
  | {
      encodingVersion: 'source-facts-json-v1';
      kind: 'snapshot';
      source: Source;
      revision: AcceptedSourceRevision & {
        completeness: { kind: 'full' } | { kind: 'unknown' };
      };
      facts: readonly [SourceFact, ...SourceFact[]];
    }
  | {
      encodingVersion: 'source-facts-json-v1';
      kind: 'changes';
      source: Source;
      revision: AcceptedSourceRevision & {
        completeness: { kind: 'incremental'; baseRevisionId: string };
      };
      changes: readonly [SourceFactMutation, ...SourceFactMutation[]];
    };

interface SourceFactArtifactManifest {
  sourceRevisionId: string;
  encodingVersion: 'source-facts-json-v1';
  adapterVersion: string;
  contentDigest: ContentDigest;
  artifact: ArtifactDescriptor;
}

interface SourceRevisionEnvelope {
  source: Source;
  revision: AcceptedSourceRevision;
}

interface SourceFactBatch {
  selectedRevisionId: string;
  chain: readonly [SourceRevisionEnvelope, ...SourceRevisionEnvelope[]];
  facts: readonly SourceFact[];
}
```

Before encoding `source-facts-json-v1`, the host sorts snapshot facts by the
managed external occurrence bytes, fact kind, and canonical fact bytes. It
sorts changes by mutation kind, target external identity bytes, evidence
occurrence bytes, and canonical mutation bytes. It rejects two byte-different
entries with the same complete sort key. `SourceFactArtifactManifest.contentDigest`
is the SHA-256 digest of the canonical value bytes for the complete
`SourceFactArtifact`. The artifact stores the same value as RFC 8785 canonical
JSON in UTF-8 with media type `application/json`. Its `ArtifactDescriptor`
digest covers those exact JSON bytes. The repository recomputes both digests
and rejects noncanonical order, semantic mismatch, or byte mismatch.

The repository orders `chain` from the oldest snapshot through the selected
revision. It recursively applies upserts and deletes. It rejects missing bases,
cross-Source bases, cycles, duplicate effective identities, and mutations whose
evidence does not belong to the incremental revision. Every retained fact
names a revision in the chain. An incremental revision may delete the final
fact, so a materialized batch may be empty. An accepted full or unknown
snapshot remains nonempty. Dataset builds consume only materialized batches.
Source-stable links resolve against the effective identity after every applied
mutation. A revision-local link or deletion always carries the exact
`sourceRevisionId`. It may target a retained base fact only when that revision
appears in the materialized chain. The host rejects an ambiguous adapter-local
link instead of guessing which occurrence it names.

One Dataset revision records every input and every policy that can change its
meaning:

```ts
interface DatasetRevision {
  id: string;
  datasetId: string;
  sourceRevisionIds: [string, ...string[]];
  build: DatasetBuildManifest;
  contentDigest: ContentDigest;
  networkArtifact: DatasetNetworkArtifact;
  serviceValidity: ServiceDateRange[];
  coverage: GeographicCoverage;
  timeZones: string[];
  languages: string[];
  attributions: Attribution[];
  licenses: LicenseRef[];
  capabilities: DatasetCapabilities;
}

interface DatasetBuildManifest {
  normalizationVersion: 'normalize-v1';
  policyVersion: 'dataset-v1';
  patternMatchingPolicyVersion: 'pattern-match-v1';
  sourcePriority: readonly [string, ...string[]];
  deduplicationPolicyVersion: 'external-identity-v1';
  conflictPolicyVersion: 'reject-conflicts-v1';
}

interface DatasetNetworkArtifact {
  encodingVersion: 'normalized-network-json-v1';
  artifact: ArtifactDescriptor;
}

interface DatasetNetworkEnvelope {
  encodingVersion: 'normalized-network-json-v1';
  network: NormalizedTransitNetwork;
  provenance: DatasetProvenance;
}
```

Version 1 uses one fixed normalization policy. `sourcePriority` contains every
Source represented by the materialized fact batches exactly once and contains
no other Source. The builder processes Sources in that order and facts by a
length-prefixed external identity key. Input, archive, page, and row order have
no effect.

`normalize-v1` uses one byte framing rule. `u32be(n)` encodes an unsigned
32-bit integer in big-endian order. `frame(parts)` starts with the part count
as `u32be`, then encodes each part as its `u32be` byte length followed by its
bytes. The encoder rejects a part count or part length above `2^32 - 1`. Text
parts use strict UTF-8. The encoder rejects unpaired surrogates and preserves
case and Unicode code points without trimming or normalization.

Managed source-stable external identity is the framed byte sequence
`['external-v1', 'managed', 'source-stable', sourceId, externalKind,
externalId]`. Managed revision-local identity inserts the exact
`sourceRevisionId` between `sourceId` and `externalKind`. One-time identity is
`['external-v1', 'upload-v1', uploadId, artifactDigest.algorithm,
artifactDigest.value, stability, recordKind, recordId]`. The surrounding
Upload fact batch supplies the same artifact digest for every Upload reference.
No Upload identity becomes an `ExternalRef`.

A direct normalized entity ID is the SHA-256 digest of the framed parts
`['normalize-v1', 'entity', normalizedEntityKind, externalIdentityBytes]`.
The nested external identity byte sequence is one part. A relationship ID
hashes `['normalize-v1', 'relationship', relationshipKind,
firstEndpointBytes, secondEndpointBytes]`, where an endpoint is the framed
`[kind, id]`. Each relationship contract fixes endpoint order. A
`line-service-plan` link places Line first, and a `service-plan-pattern` link
places ServicePlan first.

Every normalized ID is the bare 64-character lowercase hexadecimal digest. A
`ContentDigest` stores the same value as `{ algorithm: 'sha-256', value }`.
The normalizer does not use Base64, Base64url, a digest prefix, or a kind
prefix. It compares preimages and sort keys as unsigned byte sequences. It
never uses locale comparison. A label, public code, coordinate, array
position, provider format, Source priority, or input order never enters an
identity preimage. `pattern-match-v1` is the one record-specific exception
defined below.

One-time evidence uses the separate identity scope `upload-v1`. Its direct
identity components are upload ID, artifact digest algorithm and value,
normalized entity kind, upload record kind and ID, and declared stability.
The identity never survives a different upload generation. Declared
source-stable Pattern identity may select the provider Pattern ID inside that
generation. It never creates a portable `ExternalRef` or reconciliation key.

`pattern-match-v1` resolves a Pattern's Line evidence by traversing exact
Line-to-ServicePlan and ServicePlan-to-Pattern fact links. Every Pattern may be
reachable through several ServicePlans but must resolve to exactly one distinct
Line external identity. Zero or several distinct Line owners reject the build
with `ambiguous-pattern-line-ownership`. The builder does not pick an owner by
row or reference order.

A Pattern with source-stable external identity uses the direct entity rule.
This includes a declared source-stable record inside one Upload scope. Every
other Pattern uses the fallback. Its Pattern occurrence, owning Line, Stop
links, and path-carrier links must belong to one managed Source or one Upload
scope. Cross-scope fallback evidence rejects the build.

The fallback Pattern ID hashes the framed parts `['normalize-v1', 'entity',
'pattern', 'pattern-match-v1', owningLineExternalIdentityBytes,
directionToken, orderedStopSequenceToken, pathToken]`. An absent direction
token is `frame(['absent'])`. A present direction token is
`frame(['present', direction.key])`; its label never enters identity. The Stop
sequence token is `frame(['pattern-stops-v1', ...stopExternalIdentityBytes])`.
It preserves order and repeated Stops and excludes stop-call IDs and boarding
rules.

An unknown path token is `frame(['unknown'])`. A known path token is
`frame(['known', patternPathDigest])`, where `patternPathDigest` is the bare
lowercase SHA-256 hex digest of `frame(['pattern-path-v1',
...canonicalLegBytes])`. Each leg is the framed sequence
`['pattern-leg-v1', carrierKind, carrierExternalIdentityBytes,
directionState, extentState, laneState]`. The nested tokens use these exact
bytes:

```text
directionState = frame(['unknown'])
               | frame(['known', 'forward' | 'reverse'])
extentState    = frame(['unknown'])
               | frame(['known', binary64be(start), binary64be(end)])
laneState      = frame(['not-applicable'])
               | frame(['unknown'])
               | frame(['known', laneId])
```

Quoted values use strict UTF-8. A nested frame is one byte-string part in its
parent frame. `binary64be` uses the canonical number rules below. Alignment
legs use `not-applicable`; Way legs use unknown or known lane state. The path
digest preserves leg order and repetition. It does not
dereference carrier geometry or profile and does not include labels,
schedules, Trips, archive order, or row order.

`external-identity-v1` compares a fact's semantic contribution. It excludes
the external occurrence and provenance and includes the fact kind and resolved
value. Before comparison, the normalizer replaces every Link with its
normalized `{ kind, id }` endpoint. It treats these arrays as unordered sets:
Operator agency references; Line agency, operator, and ServicePlan references;
ServicePlan agency, operator, Pattern, and Schedule references; Schedule Trip
and FrequencyRule references; Calendar weekdays and exceptions; Stop anchors;
Node Way points; NamedWay Ways; Group members; and values inside an
`Applicability` of kind `only`. It sorts each set by canonical item bytes and
removes byte-equal duplicates.

Every other array preserves order and repetition. This includes Pattern stop
calls and legs, Trip stop times, template stop times, Alignment points,
polygon rings and holes, cross-section lanes, and the Ways inside a
turn-restriction `via` value.

The contract names the following recursive encoding `canonical-value-v1`.
The dependency-leaf encoder owns byte representation only. Identity framing,
sorting policy, digest preimages, and transit conflict policy remain with their
callers.

The canonical value encoder uses one-byte tags. It encodes null as `0x00`,
false as `0x01`, true as `0x02`, a number as `0x03` followed by its IEEE-754
binary64 big-endian bytes, and a string as `0x04` followed by its `u32be` UTF-8
byte length and bytes. It encodes an array as `0x05 || u32be(itemCount)` and,
for each item in order, `u32be(itemBytes.length) || itemBytes`. It encodes a
plain object as `0x06 || u32be(fieldCount)` and, for each field in unsigned
UTF-8 key order, `u32be(keyBytes.length) || keyBytes ||
u32be(valueBytes.length) || valueBytes`. `itemBytes` and `valueBytes` are the
recursive canonical encodings. A recursive value never includes the
top-level `frame` part count unless this contract explicitly calls `frame`.
The encoder accepts only finite numbers and converts negative zero to positive
zero without other rounding. It rejects `undefined`, sparse arrays, functions,
symbols, `bigint`, non-plain objects, and invalid strings. An absent property,
null, an empty value, zero, false, and an explicitly unknown value remain
distinct.

Canonical fact bytes encode `{ kind: fact.kind, value:
canonicalizedResolvedValue }` with that value encoder. Facts under one derived
identity collapse only when those bytes match; their provenance then unions.
Different bytes reject the build with `conflicting-external-identity`.
Version 1 never merges records from different Sources by name, public code,
coordinate, path similarity, or proximity. A future equivalence or conflation
model requires a new policy version and explicit evidence.

`reject-conflicts-v1` lets direct known evidence fill its own normalized field.
Derived evidence may fill only an absent or explicitly unknown field. It may
not replace direct known evidence. Ordered values such as stop calls, path
legs, and stop times remain atomic. Set-valued relationships deduplicate by
normalized endpoint identity and sort by that identity. Two distinct direct
known values for the same normalized field and identity reject the build with
`conflicting-normalized-field`; the builder never chooses by row order.

After normalization, the builder orders Lines by Source priority and then by
their portable `TransitEntityRef` key. It assigns contiguous ranks from zero.
Names, public codes, chunk arrival, and provider order never affect rank.
Changing Source priority may change display order. It never changes entity
identity.

The build manifest makes multi-source ordering and normalization reproducible.
A list of Source revision IDs alone cannot identify the policy that preserved
two provider records as separate entities or assigned their Line order.

The builder sorts each `NormalizedTransitNetwork` collection by normalized
entity or relationship ID as unsigned UTF-8 bytes. It sorts provenance entries
by target kind, target ID or endpoint IDs, and then evidence occurrence key
with the same byte comparison. `lineOrder` sorts by numeric rank and then Line
ID. These array orders are part of `normalized-network-json-v1`.

`DatasetRevision.contentDigest` is the SHA-256 digest of the canonical value
bytes for `{ encodingVersion: 'normalized-network-json-v1', network,
provenance }` after those orders are fixed. The immutable artifact stores that
same object as RFC 8785 canonical JSON encoded as UTF-8 with media type
`application/json`. Its `ArtifactDescriptor` digest covers those exact JSON
bytes. Semantic digest and artifact-byte digest are intentionally separate;
both must remain stable under permuted input. The decoder rejects an artifact
whose bytes are not canonical, whose byte digest differs, or whose decoded
semantic digest differs from `DatasetRevision.contentDigest`.

`DatasetNetworkArtifact` points to that immutable encoded envelope in artifact
storage. D1 stores its descriptor and bounded revision metadata, not the
country-scale provenance graph. A separate `DatasetCacheManifest` records chunk
encoding, build version, and index locations for one Dataset revision. The
repository may delete and rebuild that manifest without changing the Dataset
revision.

```ts
interface DatasetCacheManifest {
  datasetRevisionId: string;
  encodingVersion: 'dataset-chunk-json-v1';
  builderVersion: string;
  chunks: ChunkIndexManifest;
}
```

`normalized-network-json-v1` is the canonical recoverable semantic and
provenance artifact. Its decoder dispatches by encoding version. A cache
rebuild reads that artifact and never reruns a historical normalizer.
`dataset-chunk-json-v1` is only a bounded delivery cache. The repository may
delete and rebuild it from the canonical artifact without changing the Dataset
revision.

The cache index preserves semantic order and explicit query dimensions:

```ts
interface DatasetCapabilities {
  sourceClaims: readonly SourceCapability[];
  modeIds: readonly string[];
  representationIds: readonly [string, ...string[]];
  filters: readonly ViewFilterDefinition[];
}

interface ChunkIndexManifest {
  lineOrder: readonly LineOrderEntry[];
  entries: readonly ChunkIndexEntry[];
}

interface ChunkIndexEntry {
  chunkId: string;
  bounds: GeographicBounds;
  detailBand: DetailBand;
  modeIds: readonly string[];
  serviceValidity: readonly ServiceDateRange[];
  artifact: ArtifactDescriptor;
  overflowArtifacts: readonly ArtifactDescriptor[];
}
```

Dataset provenance maps every normalized entity and explicit membership-link
identity back to exact external facts:

```ts
interface DatasetProvenanceEntry {
  target: DatasetProvenanceTarget;
  facts: SourceFactAttribution[];
}

interface SourceFactAttribution {
  fact: ExternalFactRef;
  relation: 'direct' | 'normalized' | 'matched' | 'derived';
  policyVersion: string;
}

interface DatasetProvenance {
  entries: DatasetProvenanceEntry[];
}
```

`UploadFactRef` exists only while building and reviewing a one-time import. It
supports the same normalization policies without pretending that the file is a
portable Source. It may enter import-plan evidence and import history. It may
not enter `DatasetProvenance`, `SourceCitation`, or `SourceBinding`.

The repository must support lookup in both directions. One canonical entry
set plus derived indexes is sufficient. A second independently stored mapping
would drift. `datasetProvenanceTargetKey` encodes target kind and ID with the
same length-prefixed UTF-8 rule as portable entity keys.

Authored import bindings use stable external identity instead of one immutable
fact occurrence:

```ts
interface SourceBinding {
  external: ExternalRef;
  target: TransitEntityRef;
  lastAppliedRevisionId: string;
  baseline: SourceBindingBaseline;
}

interface SourceBindingBaseline {
  sourceHash: string;
  targetHash: string;
  schemaVersion: '17';
  normalizerVersion: 'reviewed-import-v1';
}

interface LegacyServiceAlias {
  legacyServiceId: string;
  lineId: string;
  servicePlanId: string;
  patternIds: {
    outbound: string;
    inbound?: string;
  };
}

interface LegacySourceReference {
  target: Extract<TransitEntityRef, { kind: 'way' }>;
  value: string;
}

interface ImportHistoryEntry {
  id: string;
  importedAt: string;
  origin:
    | { kind: 'managed-dataset'; datasetRevisionId: string }
    | {
        kind: 'one-time-upload';
        artifactDigest: ContentDigest;
        mediaType: string;
        label?: string;
        attribution?: Attribution;
        license?: LicenseRef;
      };
}
```

The v16 migration uses `legacyDerivedId(kind, ...parts)` for every identity
that has no v16 predecessor. The encoded value is
`v16:<kind>:<utf8-byte-length>:<part>:...`. The encoder retains each part's
original UTF-8 bytes without case or Unicode normalization. Length prefixes
make delimiters inside a part unambiguous. Numeric parts use unsigned base-10
text with no leading zeros except the value zero.

`LegacyServiceAlias` is a compatibility record. It does not enter
`TransitEntityRef`. Reader and embed hosts use its Line target for old Service
focus. The editor uses its ServicePlan target. A run-qualified path reference
uses the corresponding Pattern target.

`LegacySourceReference` preserves an opaque schema-v16 `Way.source` string
without assigning authority that the string never carried. It cannot become
an `ExternalRef`, `SourceCitation`, or `SourceBinding`. A later import may
replace it only through ordinary reviewed matching and an explicit managed
Source identity. Parsers preserve every string value exactly. An empty string
therefore remains an empty compatibility marker.

An active binding is unique by external identity and authored target. A new
Source revision updates `lastAppliedRevisionId`; it does not create another
active binding. Import history is a separate event log. `sourceHash` hashes
the canonical normalized record under the recorded schema and normalizer.
Specifically, it is the lowercase SHA-256 digest of canonical value bytes for
`{ version: 'source-binding-baseline-v1', schemaVersion, normalizerVersion,
external, record }`. `targetHash` uses the same encoder for
`{ version: 'target-binding-baseline-v1', schemaVersion, normalizerVersion,
target, entity }`. `record` is the one normalized source-backed entity before
authored conversion. `entity` is the one canonical authored entity after
conversion. Neither hash includes the rest of the Dataset or TransitSystem.
The planner rejects a baseline whose recorded identity does not match the
record or entity supplied for recomputation.

Source IDs must remain portable across repositories. A portable
`TransitSystem` export also embeds a `SourceCitation` stub for every Source ID
used by its bindings. The stub retains name, publisher, attribution, and
license when the Source repository is unavailable.

A one-time upload does not identify a stable external series. It records an
`ImportHistoryEntry` with the captured artifact digest and supplied citation,
but it creates no `SourceBinding` and claims no automatic refresh or
reconciliation authority. A later upload starts a new reviewed import. Only a
managed Dataset revision may create active bindings to portable Source IDs.

Reviewed-import IDs use the canonical value encoder in this reference. A
managed input digest is its verified `DatasetRevision.contentDigest`. A
one-time input digest hashes `{ version: 'one-time-upload-v1',
importHistoryId, artifactDigest, network, provenance }`. Candidate-set,
candidate-chunk, review, patch-chunk, and plan digests hash these exact values:

```text
{ version: 'candidate-set-v1', inputDigest, candidates }
{ version: 'candidate-chunk-v1', candidateSetId, sequence, candidates }
{
  version: 'review-v1', inputDigest, candidateSetId, accepted,
  baseSystemDigest, affected, conflicts
}
{ version: 'import-patch-chunk-v1', sequence, patches }
{
  version: 'import-plan-v1', reviewId, baseSystemDigest, affected,
  conflictResolutions, chunks, finalSystemDigest
}
```

Candidates use deterministic topological order. Accepted references preserve
that order. Affected references use canonical entity-reference byte order.
Conflicts sort by ID. Chunks use contiguous sequence order. The upload preimage
includes its import-history ID, so repeated equal bytes remain separate review
events. Each conflict ID is the bare lowercase SHA-256 digest of
`frame(['import-conflict-v1', targetBytes, fieldPathBytes])`, where
`targetBytes` is `frame([target.kind, target.id])` and `fieldPathBytes` is the
canonical value encoding of the typed field path. The final System digest uses
`transit-system-json-v1`.

## Transit facts

| Type                | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| `Line`              | Passenger-facing identity, name, color, and service-plan membership          |
| `ServicePlan`       | Operational grouping of Patterns and Schedules beneath one Line              |
| `Pattern`           | One ordered stop-call pattern with a known or unknown directional path       |
| `Schedule`          | Exact Trips or frequency rules that apply on Calendars                       |
| `Calendar`          | Recurring service days, date bounds, exceptions, and service timezone        |
| `Trip`              | One scheduled run through a Pattern                                          |
| `Stop`              | One physical boarding point                                                  |
| `Station`           | One named passenger place that groups Stops                                  |
| `Alignment`         | Known geographic travel path without an implied road, track, or lane profile |
| `Way`               | A physical-infrastructure claim that uses an Alignment and cross-section     |
| `OperationalChange` | Structured, time-bounded amendment to planned operations                     |
| `Advisory`          | Rider communication and affected-entity selectors                            |

A `Line` owns passenger identity. This means the Line is the named and colored
thing that a rider sees in a legend. The Line does not own one complete route
geometry. Its Patterns may share trunks, split into branches, short-turn, or
change temporarily.

A `ServicePlan` has one mode. One Line may own several ServicePlans. A
temporary bus replacement and the rail service it replaces therefore remain
separate ServicePlans under the same passenger Line.

An authored ServicePlan may carry a rough planning summary. The summary keeps
the editor's optional peak headway and span without pretending that those
values prove a Calendar, Trip, or exact operating period. The effective-service
resolver uses Schedules. Simulation may use the summary only as an explicitly
approximate fallback.

```ts
interface ServicePlan {
  id: string;
  name?: string;
  modeId: string;
  vehicleKindId?: string;
  patternIds: string[];
  scheduleIds: string[];
  planningSummary?: ServicePlanningSummary;
}

interface ServicePlanningSummary {
  peakHeadwaySeconds?: number;
  spanStartSeconds?: number;
  spanEndSeconds?: number;
}
```

A Pattern is directional through the order of its legs and stop calls. Source
values such as GTFS `direction_id` remain optional metadata. They do not become
a required outbound or inbound enum.

```ts
interface Pattern {
  id: string;
  direction?: PatternDirection;
  path: PatternPath;
  stopCalls: PatternStopCall[];
}

interface PatternDirection {
  key: string;
  label?: string;
}

type PatternPath = { kind: 'known'; legs: PatternLeg[] } | { kind: 'unknown' };

interface PatternStopCall {
  id: string;
  stopId: string;
}
```

An unknown path is a valid source-backed state. It is not an empty known path.
The viewer may show stops without claiming travel geometry.

A Schedule owns time. Every Trip and FrequencyRule links one Pattern to one
Calendar:

```ts
interface Schedule {
  id: string;
  tripIds: string[];
  frequencyRuleIds: string[];
}

interface Trip {
  id: string;
  patternId: string;
  calendarId: string;
  stopTimes: ScheduledStopTime[];
}

interface FrequencyRule {
  id: string;
  label?: string;
  patternId: string;
  calendarId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  headwaySeconds: number;
  precision: 'exact' | 'headway' | 'unknown';
  templateStopTimes: ScheduledStopTime[];
}

interface ScheduledStopTime {
  stopCallId: string;
  arrivalSeconds?: number;
  departureSeconds?: number;
  precision: 'exact' | 'estimated' | 'unknown';
  pickup: BoardingRule;
  dropOff: BoardingRule;
}

interface Calendar {
  id: string;
  timeZone: ServiceTimeZone;
  dateRange: ServiceDateRange;
  activeWeekdays: Weekday[];
  exceptions: CalendarException[];
}

type ServiceTimeZone = { kind: 'iana'; value: string } | { kind: 'unknown' };

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface CalendarException {
  serviceDate: string;
  action: 'add' | 'remove';
}

type BoardingRule = 'regular' | 'none' | 'request' | 'coordinate' | 'unknown';

type ServiceDateRange =
  | { kind: 'bounded'; startDate: string; endDate: string }
  | { kind: 'from'; startDate: string }
  | { kind: 'through'; endDate: string }
  | { kind: 'unbounded' };
```

Scheduled times are offsets from the Calendar's service day. They may exceed
86,400 seconds. Arrival and departure remain optional when the source omits
them. Precision, pickup, and drop-off rules remain explicit. The Calendar owns
the service timezone, recurring days, date bounds, and added or removed dates.
A network query supplies an instant. The resolver maps that instant through
each Calendar timezone and daylight-saving rule.

Source-backed Calendars normally use bounded ranges because the publisher
supplies service dates. An authored recurring plan may use `unbounded` when no
date evidence exists. The migration never invents a start or end date.

A Source-backed Calendar uses a known IANA timezone when its source supplies
one. An authored Calendar may retain `unknown` until the author chooses a
timezone. An instant query cannot claim exact active service for that Calendar;
the coverage assessment reports unknown service evidence instead.

A calendar or headway change does not create another geometric Pattern. A
detour creates a time-bounded effective Pattern only when structured source
data supplies the changed path or stop sequence.

An `Advisory` never creates a Pattern, Alignment, Trip, or Schedule. It may
refer to those records and describe their impact.

## Value conventions

| Value                | Rule                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| Service date         | `YYYY-MM-DD` in the referenced Calendar timezone                            |
| Instant              | RFC 3339 timestamp with an explicit offset                                  |
| Service-day time     | Integer seconds from local service-day midnight. Values may exceed 86,400.  |
| Known timezone       | IANA timezone identifier                                                    |
| Source identifier    | Stable and portable across repositories                                     |
| Normalized entity ID | Stable within its owning System or Dataset revision and independent of rows |

Adapters retain source precision. They do not convert an unknown, estimated,
or request-only value into an exact value.

## Normalized dataset network

A Dataset revision owns one immutable semantic aggregate. It is not a
`TransitSystem` alias. It retains source-backed identities and schedules that
an authored document may never import.

```ts
interface NormalizedPublisher {
  id: string;
  name: string;
  url?: string;
}

interface NormalizedAgency {
  id: string;
  name?: string;
  shortName?: string;
  timeZone: ServiceTimeZone;
}

interface NormalizedOperator {
  id: string;
  name?: string;
  agencyIds: readonly string[];
}

interface NormalizedLine {
  id: string;
  name?: string;
  publicCode?: string;
  color?: string;
  agencyIds: readonly string[];
  operatorIds: readonly string[];
}

interface NormalizedServicePlan {
  id: string;
  name?: string;
  mode: KnownOrUnknown<string>;
  vehicleKindId?: string;
  agencyIds: readonly string[];
  operatorIds: readonly string[];
  scheduleIds: readonly string[];
}

interface NormalizedLineServicePlanLink {
  id: string;
  lineId: string;
  servicePlanId: string;
}

interface NormalizedServicePlanPatternLink {
  id: string;
  servicePlanId: string;
  patternId: string;
}

interface NormalizedAlignment {
  id: string;
  path: KnownOrUnknown<readonly [LngLat, LngLat, ...LngLat[]]>;
}

type NormalizedPatternLeg =
  | {
      kind: 'alignment';
      alignmentId: string;
      direction: KnownOrUnknown<LegDirection>;
      extent: KnownOrUnknown<LegExtent>;
    }
  | {
      kind: 'way';
      wayId: string;
      direction: KnownOrUnknown<LegDirection>;
      extent: KnownOrUnknown<LegExtent>;
      laneId: KnownOrUnknown<string>;
    };

type NormalizedPatternPath =
  | { kind: 'unknown' }
  | { kind: 'known'; legs: readonly [NormalizedPatternLeg, ...NormalizedPatternLeg[]] };

interface NormalizedPatternStopCall {
  id: string;
  stopId: string;
}

interface NormalizedPattern {
  id: string;
  direction?: PatternDirection;
  path: NormalizedPatternPath;
  stopCalls: readonly NormalizedPatternStopCall[];
}

interface NormalizedWay {
  id: string;
  alignmentId: string;
  alignmentExtent: readonly [number, number];
  typeId: string;
  grade: Grade;
  profile: CrossSection;
  classId?: string;
}

interface NormalizedStop {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
  stationId?: string;
  anchors: readonly { carrier: TransitCarrierRef; position: number }[];
  major: boolean;
}

interface NormalizedStation {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
  footprint?: GeographicPolygon;
}

interface NormalizedNode {
  id: string;
  location: KnownOrUnknown<LngLat>;
  wayPoints: readonly { wayId: string; pointIndex: number }[];
  controlId?: string;
}

interface NormalizedNamedWay {
  id: string;
  name: string;
  wayIds: readonly [string, ...string[]];
}

interface NormalizedMedian {
  id: string;
  namedWayId: string;
  widthMeters: number;
  kindId: string;
}

interface NormalizedLaneConnector {
  id: string;
  nodeId: string;
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

interface NormalizedTurnRestriction {
  id: string;
  from: { wayId: string; laneIds: Applicability<string> };
  to: { wayId: string; laneIds: Applicability<string> };
  via: { kind: 'node'; nodeId: string } | { kind: 'ways'; wayIds: readonly [string, ...string[]] };
  movement: 'prohibited' | 'only';
  modeIds: Applicability<string>;
}

interface NormalizedApproachControl {
  id: string;
  nodeId: string;
  wayId: string;
  end: 'start' | 'end';
  controlId: string;
}

interface NormalizedFacility {
  id: string;
  typeId: string;
  name?: string;
  geometry: KnownOrUnknown<LngLat | GeographicPolygon>;
}

interface NormalizedGroup {
  id: string;
  name?: string;
  members: readonly TransitEntityRef[];
  footprint?: GeographicPolygon;
  color?: string;
}

interface LineOrderEntry {
  lineId: string;
  rank: number;
}

interface NormalizedTransitNetwork {
  publishers: readonly NormalizedPublisher[];
  agencies: readonly NormalizedAgency[];
  operators: readonly NormalizedOperator[];
  lines: readonly NormalizedLine[];
  servicePlans: readonly NormalizedServicePlan[];
  lineServicePlans: readonly NormalizedLineServicePlanLink[];
  servicePlanPatterns: readonly NormalizedServicePlanPatternLink[];
  patterns: readonly NormalizedPattern[];
  schedules: readonly Schedule[];
  calendars: readonly Calendar[];
  trips: readonly Trip[];
  frequencyRules: readonly FrequencyRule[];
  stops: readonly NormalizedStop[];
  stations: readonly NormalizedStation[];
  alignments: readonly NormalizedAlignment[];
  ways: readonly NormalizedWay[];
  nodes: readonly NormalizedNode[];
  namedWays: readonly NormalizedNamedWay[];
  medians: readonly NormalizedMedian[];
  laneConnectors: readonly NormalizedLaneConnector[];
  turnRestrictions: readonly NormalizedTurnRestriction[];
  approachControls: readonly NormalizedApproachControl[];
  facilities: readonly NormalizedFacility[];
  groups: readonly NormalizedGroup[];
  lineOrder: readonly LineOrderEntry[];
}
```

The builder assigns every normalized identity through its recorded policy. It
sorts every array canonically and assigns each Line one unique nonnegative
rank. It never derives semantic order from source rows, object iteration,
database rows, cache chunks, or response arrival. Publisher, Agency, and
Operator facts normalize into their corresponding records. They therefore use
ordinary Dataset provenance and stable entity references.
`NormalizedOperator.agencyIds` owns the Agency-to-Operator relationship.
Line-level Agency and Operator IDs describe the passenger brand. ServicePlan
Agency and Operator IDs describe the operator of that operational plan.
`NormalizedLineServicePlanLink` and `NormalizedServicePlanPatternLink` are the
sole membership owners. They let overlays join a new ServicePlan to a base Line
without copying or shadowing the Line. Unknown Alignment paths, Node locations,
and Facility geometry remain explicit facts. They retain provenance and affect
coverage, but they produce no geometry fragment until later evidence makes the
geometry known. A routing projection may compile a turn restriction into
lane-level allowed targets only when topology and lane applicability are known.
It retains the semantic restriction without enforcing a guessed movement when
either is unknown.

`NormalizedWay.alignmentExtent` is finite, ascending, and contained by
`[0, 1]`. It is the sole normalized owner of the Way-to-Alignment mapping. A
builder splits a source Way before normalization when its correspondence is
not monotonic and affine. It never stores a different mapping on each Pattern
that uses the Way.

`NormalizedPattern` is a source-backed value. It does not reuse the stricter
authored `Pattern` type. A known source path may retain an unknown leg
direction, extent, or Way lane. `NormalizedAlignment.path` retains only the
points supplied by source evidence. It does not invent authored curve controls
or another geometry representation. The network resolver emits a resolved
known path and geometry only when every required carrier path and leg value is
known and valid. Otherwise it retains the Pattern and stop calls but reports
unknown geometry. A reviewed import converts an incomplete normalized path to
an authored `{ kind: 'unknown' }` path. It never supplies a default direction,
extent, lane, curve control, or geometry to make the authored type fit.

## Operational records

Realtime adapters use a separate provider-neutral claim boundary. Their links
target records in the planned Source named by `Source.relationships.updates`.
They do not pretend that realtime records are planned network facts.

```ts
type OperationalClaim<Occurrence, Link> =
  | Fact<'trip-update', Occurrence, TripUpdateClaim<Occurrence, Link>>
  | Fact<'trip-modification', Occurrence, TripModificationClaim<Occurrence, Link>>
  | Fact<'service-alert', Occurrence, ServiceAlertClaim<Link>>;

interface TripInstanceEvidence<Occurrence, Link> {
  target:
    | { kind: 'planned-trip'; trip: Link }
    | {
        kind: 'added-trip';
        trip: Occurrence;
        passengerIdentity:
          { kind: 'line'; line: Link } | { kind: 'service-plan'; servicePlan: Link };
      };
  serviceDate?: string;
  startTimeSeconds?: number;
}

interface OperationalStopTimeClaim<Link> {
  stop?: Link;
  sequence?: number;
  arrivalSeconds?: number;
  departureSeconds?: number;
  arrivalDelaySeconds?: number;
  departureDelaySeconds?: number;
  precision: 'exact' | 'estimated' | 'unknown';
  service: 'served' | 'skipped' | 'unknown';
}

interface TripUpdateClaim<Occurrence, Link> {
  trip: TripInstanceEvidence<Occurrence, Link>;
  relationship: 'scheduled' | 'added' | 'cancelled' | 'unknown';
  stopTimes: readonly OperationalStopTimeClaim<Link>[];
}

interface TripModificationClaim<Occurrence, Link> {
  trip: TripInstanceEvidence<Occurrence, Link>;
  replacementTrip: Occurrence;
  stopCalls: readonly FactPatternStopCall<Link>[];
  path: FactPatternPath<Link>;
  stopTimes: readonly OperationalStopTimeClaim<Link>[];
}

interface ServiceAlertClaim<Link> {
  affected: readonly Link[];
  scope?: OperationalScope;
  cause?: string;
  effect?: string;
  text: readonly LocalizedAdvisoryText[];
}

type OperationalAdapterFact = OperationalClaim<AdapterLocalRef, AdapterLocalRef>;
type OperationalSourceFact = OperationalClaim<ExternalFactRef, ExternalRecordRef>;

type OperationalAdapterFactMutation =
  { kind: 'upsert'; claim: OperationalAdapterFact } | { kind: 'delete'; target: AdapterLocalRef };

type OperationalAdapterFactBatch =
  | {
      kind: 'snapshot';
      completeness: 'full' | 'unknown';
      claims: readonly OperationalAdapterFact[];
    }
  | {
      kind: 'changes';
      changes: readonly [OperationalAdapterFactMutation, ...OperationalAdapterFactMutation[]];
    };

type OperationalAdapterResult =
  | {
      kind: 'accepted';
      validation: AcceptedRevisionValidation;
      batch: OperationalAdapterFactBatch;
    }
  | {
      kind: 'rejected';
      validation: Extract<RevisionValidation, { kind: 'rejected' }>;
    };

type OperationalFactMutation =
  | { kind: 'upsert'; claim: OperationalSourceFact }
  | { kind: 'delete'; evidence: ExternalFactRef; target: ExternalRecordRef };

type OperationalFactArtifact =
  | {
      encodingVersion: 'operational-facts-json-v1';
      kind: 'snapshot';
      source: Source;
      revision: AcceptedSourceRevision & {
        completeness: { kind: 'full' } | { kind: 'unknown' };
      };
      claims: readonly OperationalSourceFact[];
    }
  | {
      encodingVersion: 'operational-facts-json-v1';
      kind: 'changes';
      source: Source;
      revision: AcceptedSourceRevision & {
        completeness: { kind: 'incremental'; baseRevisionId: string };
      };
      changes: readonly [OperationalFactMutation, ...OperationalFactMutation[]];
    };

interface OperationalFactArtifactManifest {
  sourceRevisionId: string;
  encodingVersion: 'operational-facts-json-v1';
  adapterVersion: string;
  contentDigest: ContentDigest;
  artifact: ArtifactDescriptor;
}
```

Before encoding `operational-facts-json-v1`, the host sorts snapshot claims by
managed external occurrence bytes, claim kind, and canonical claim bytes. It
sorts changes by mutation kind, target external identity bytes, evidence
occurrence bytes, and canonical mutation bytes. It rejects two byte-different
entries with the same complete sort key.
`OperationalFactArtifactManifest.contentDigest` is the SHA-256 digest of the
canonical value bytes for the complete `OperationalFactArtifact`. The artifact
stores the same value as RFC 8785 canonical JSON in UTF-8 with media type
`application/json`. Its `ArtifactDescriptor` digest covers those exact JSON
bytes. The repository recomputes both digests and rejects noncanonical order,
semantic mismatch, or byte mismatch.

Version 1 requires each realtime Source to have exactly one `updates`
relationship. The operational host qualifies each claim occurrence with the
realtime Source revision. It qualifies every planned link with that one related
planned Source. A full revision may contain no claims and therefore clear the
prior operational state for that realtime Source. An incremental revision is a
delta against its exact `completeness.baseRevisionId`. An unknown revision
is a standalone set of supplied claims over planned service. It never inherits
omitted claims from an earlier realtime revision, and it never asserts that an
omitted claim is absent. Coverage for omitted operational evidence remains
unknown. The artifact carries no second basis field that could contradict
completeness. A differential deletion is an explicit mutation. Unsupported
vehicle observations remain validation issues outside this artifact.

An operational deletion targets a claim occurrence in the same realtime
Source chain. Its evidence belongs to the incremental revision, and its target
kind matches the deleted claim kind. It cannot delete a planned record in the
related Source.

An OperationalSnapshot is one immutable normalized capture over one exact
Dataset revision. Full and unknown snapshots store a complete operational
state. Delta snapshots store ordered mutations against one exact base.

```ts
interface OperationalBuildManifest {
  normalizationVersion: 'operational-normalize-v1';
  conflictPolicyVersion: 'operational-precedence-v1';
  selectionPolicyVersion: 'operational-latest-v1';
  sourcePriority: readonly [string, ...string[]];
}

interface OperationalEntityOverlay {
  lines: readonly NormalizedLine[];
  servicePlans: readonly NormalizedServicePlan[];
  lineServicePlans: readonly NormalizedLineServicePlanLink[];
  servicePlanPatterns: readonly NormalizedServicePlanPatternLink[];
  patterns: readonly NormalizedPattern[];
  stops: readonly NormalizedStop[];
  stations: readonly NormalizedStation[];
  alignments: readonly NormalizedAlignment[];
}

interface OperationalState {
  overlay: OperationalEntityOverlay;
  changes: readonly OperationalChange[];
  advisories: readonly Advisory[];
}

type OperationalOverlayEntityRef = Extract<
  TransitEntityRef,
  {
    kind: 'line' | 'service-plan' | 'pattern' | 'stop' | 'station' | 'alignment';
  }
>;

type OperationalStateMutation =
  | { kind: 'upsert-overlay'; entity: OperationalOverlayEntity }
  | { kind: 'delete-overlay'; target: OperationalOverlayEntityRef }
  | { kind: 'upsert-line-service-plan'; link: NormalizedLineServicePlanLink }
  | { kind: 'delete-line-service-plan'; linkId: string }
  | { kind: 'upsert-service-plan-pattern'; link: NormalizedServicePlanPatternLink }
  | { kind: 'delete-service-plan-pattern'; linkId: string }
  | { kind: 'upsert-change'; change: OperationalChange }
  | { kind: 'delete-change'; operationalChangeId: string }
  | { kind: 'upsert-advisory'; advisory: Advisory }
  | { kind: 'delete-advisory'; advisoryId: string };

type OperationalOverlayEntity =
  | { kind: 'line'; value: NormalizedLine }
  | { kind: 'service-plan'; value: NormalizedServicePlan }
  | { kind: 'pattern'; value: NormalizedPattern }
  | { kind: 'stop'; value: NormalizedStop }
  | { kind: 'station'; value: NormalizedStation }
  | { kind: 'alignment'; value: NormalizedAlignment };

interface OperationalSnapshotBase {
  id: string;
  datasetRevisionId: string;
  sourceRevisionIds: readonly [string, ...string[]];
  capturedAt: string;
  freshUntil?: string;
  build: OperationalBuildManifest;
  contentDigest: ContentDigest;
}

type OperationalSnapshot = OperationalSnapshotBase &
  (
    | { basis: { kind: 'full' } | { kind: 'unknown' }; state: OperationalState }
    | {
        basis: { kind: 'delta'; baseSnapshotId: string };
        mutations: readonly [OperationalStateMutation, ...OperationalStateMutation[]];
      }
  );

interface MaterializedOperationalSnapshot {
  selectedSnapshotId: string;
  chain: readonly [OperationalSnapshot, ...OperationalSnapshot[]];
  state: OperationalState;
}
```

`OperationalBuildManifest.sourcePriority` contains every participating
realtime Source exactly once and no planned Source unless that Source also
publishes realtime claims. The first Source has the highest priority. This
list is separate from `DatasetBuildManifest.sourcePriority`, which orders
planned Sources and Lines.

`operational-normalize-v1` uses the same `frame`, strict UTF-8, canonical
value, unsigned-byte ordering, and lowercase SHA-256 rules as `normalize-v1`.
A source-stable claim uses the managed source-stable external identity bytes
defined above. A revision-local claim uses the managed revision-local bytes.
An overlay entity ID hashes `['operational-normalize-v1', 'overlay-entity',
entityKind, externalIdentityBytes]`. An `OperationalChange` ID hashes
`['operational-normalize-v1', 'change', claimKind,
externalIdentityBytes]`. An `Advisory` ID hashes
`['operational-normalize-v1', 'advisory',
externalIdentityBytes]`. An overlay relationship ID hashes
`['operational-normalize-v1', 'relationship', relationshipKind,
firstEndpointBytes, secondEndpointBytes]` with the same endpoint framing and
Line-first or ServicePlan-first order as the planned relationship. A realtime
Source never shares an identity with another realtime Source.

Two claims from one realtime Source with the same normalized ID collapse only
when their canonical claim bytes match. The normalizer unions their provenance.
Different bytes reject the snapshot build with
`conflicting-operational-identity`. Normalized overlay entities and
relationships sort by ID. Changes and Advisories sort by ID. Source revision
IDs sort by `OperationalBuildManifest.sourcePriority`. A snapshot contains
exactly one accepted materialized head for each participating realtime Source.

`operational-precedence-v1` converts claims into field assertions. A semantic
conflict key identifies one field on one target. Trip status and replacement
Pattern use `TripInstanceRef`. Stop service uses `TripInstanceRef` plus
`stopCallId`. Arrival and departure time use `TripInstanceRef` plus
`stopCallId` plus the time field. Entity suspension uses the target
`TransitEntityRef`. An overlay entity or relationship uses its normalized ID.
Assertions with different keys coexist. Two different values for one key from
the same realtime Source reject the snapshot. Across Sources, the assertion
from the earliest Source in operational `sourcePriority` wins. Cancellation
coexists with other fields, but the resolver applies cancelled status last and
hides the Trip. Advisories union by ID and never override an operation.

`OperationalSnapshot.contentDigest` is the SHA-256 digest of the canonical
value bytes for `{ datasetRevisionId, sourceRevisionIds, capturedAt,
freshUntil, build, basis, state }` for a full or unknown snapshot. A delta uses
the same object with `mutations` in place of `state`. An absent `freshUntil`
remains absent. The repository rejects a snapshot whose arrays do not follow
the canonical order above or whose recomputed digest differs.
`OperationalSnapshot.id` is the bare lowercase SHA-256 digest of
`frame(['operational-snapshot-v1', datasetRevisionId,
contentDigest.algorithm, contentDigest.value])`.

`operational-latest-v1` considers a snapshot only when its complete chain
materializes and its `datasetRevisionId` equals the resolved Dataset revision.
It chooses the snapshot with the greatest RFC 3339 `capturedAt` instant. Equal
instants choose the lexicographically smallest lowercase snapshot ID by
unsigned UTF-8 bytes. `freshUntil` reports freshness but does not select an
older snapshot. A stale or missing snapshot never erases planned service. A
`latest` selector resolves to one concrete snapshot before cache lookup. A
`pinned` selector uses its exact snapshot or fails validation.

Every overlay reference resolves either within the overlay or in the base
Dataset revision. A structured detour may therefore introduce temporary Stops
and Alignments without changing the immutable planned network. It cannot
introduce a Way because an operational path does not prove physical
infrastructure. Explicit Line-ServicePlan and ServicePlan-Pattern links own
overlay membership and may join a new overlay entity to an existing base
entity. An overlay may not shadow a base identity. The repository materializes
a delta chain oldest to newest and rejects missing bases, cycles, cross-Dataset
bases, shadowed identities, duplicate relationship ownership, and dangling
overlay references. Freshness policy decides when live state expires. A stale
or missing Snapshot never erases the planned Dataset revision.

Operational changes use a provider-neutral operation algebra:

```ts
interface OperationalChange {
  id: string;
  external: [ExternalFactRef, ...ExternalFactRef[]];
  scope: OperationalScope;
  operations: OperationalOperation[];
}

type OperationalScope =
  | { kind: 'service-dates'; serviceDates: [string, ...string[]] }
  | { kind: 'absolute'; activePeriods: [InstantRange, ...InstantRange[]] }
  | {
      kind: 'service-dates-and-absolute';
      serviceDates: [string, ...string[]];
      activePeriods: [InstantRange, ...InstantRange[]];
    };

interface TripInstanceRef {
  tripId: string;
  serviceDate: string;
  startTimeSeconds?: number;
}

interface OperationalTrip {
  id: string;
  relationships: OperationalRelationship[];
  servicePlanId: string;
  patternId: string;
  serviceDate: string;
  startTimeSeconds?: number;
  stopTimes: ScheduledStopTime[];
}

type OperationalRelationship = {
  kind: 'replaces';
  targets: [TransitEntityRef, ...TransitEntityRef[]];
};

type OperationalOperation =
  | { kind: 'cancel-trip'; trip: TripInstanceRef }
  | { kind: 'add-trip'; trip: OperationalTrip }
  | { kind: 'replace-pattern'; trip: TripInstanceRef; patternId: string }
  | { kind: 'skip-stop'; trip: TripInstanceRef; stopCallId: string }
  | {
      kind: 'change-stop-times';
      trip: TripInstanceRef;
      stopTimes: ScheduledStopTime[];
    }
  | { kind: 'suspend'; target: TransitEntityRef };
```

The scope union requires at least one service date or active period.
Service-date scope and absolute active periods remain separate. This preserves
schedule semantics across timezones and daylight-saving changes. The Dataset
build manifest supplies planned normalization and Line order. The
OperationalSnapshot build manifest supplies realtime identity, precedence,
and selection policy. Snapshot arrival order never decides which operation
wins.

An OperationalTrip names its ServicePlan and Pattern. The overlay's explicit
membership links provide the only Line-ServicePlan and ServicePlan-Pattern
associations. A replacement may add a bus ServicePlan beneath the affected
Line. A provider may instead give the replacement its own temporary Line.
`OperationalRelationship` names the disrupted Line, ServicePlan, Pattern, or
Trip that it replaces. Every new Line, ServicePlan, Pattern, Stop, Station, or
Alignment named by an operation exists in the same materialized overlay. An
existing reference resolves in the base Dataset revision. The snapshot parser
rejects all other references.

Advisories retain communication and selectors without inventing operations:

```ts
interface Advisory {
  id: string;
  external: [ExternalFactRef, ...ExternalFactRef[]];
  scope?: OperationalScope;
  affected: TransitEntityRef[];
  cause?: string;
  effect?: string;
  text: LocalizedAdvisoryText[];
}
```

An empty `affected` list means that the source supplied no narrower selector.
It does not authorize TransitMapper to infer a segment. `scope` remains absent
when the source supplies no reliable service dates or active period.

Vehicle positions and predictions are outside this target. They require a
separate high-churn observation frame with observation time, uncertainty,
freshness, and exact Source revision lineage. They do not belong in
`OperationalChange`.

## Boundary types

| Kind              | Examples                                             | Boundary rule                                                       |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Content reference | `ContentRef`, revision and operational selectors     | May identify a System or Dataset. It never embeds either one.       |
| Network query     | Bounds, service instant, modes, filters, detail band | Supports local evaluation and remote query pushdown.                |
| Query result      | Coverage report, stable Line order, chunks, cursor   | Distinguishes no service from unavailable or unknown data.          |
| Network transfer  | `ResolvedNetworkChunk`, cursor, cache metadata       | Contains semantic transit facts. It contains no provider rows.      |
| API contract      | Resource, request, response, page, error             | Versions the wire shape. It does not reuse database row interfaces. |
| Renderer contract | `RenderPresentation`, `RenderScene`, scene patch     | Contains resolved display input or output. It contains no schedule. |

The network query is separate from map presentation. The host first resolves a
mutable selector into one concrete content identity. It then uses that identity
for every page, cache key, search, and details request.

```ts
type DetailBand = 'overview' | 'district' | 'street';
type ViewFilterValue = boolean | string | readonly string[];
type ModeSelection = { kind: 'all' } | { kind: 'only'; ids: readonly string[] };

interface MapCamera {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface ViewQuery {
  serviceTime: { kind: 'live' } | { kind: 'instant'; value: string };
  modes: ModeSelection;
  filters: Readonly<Record<string, ViewFilterValue>>;
}

interface NetworkQuery extends ViewQuery {
  bounds: GeographicBounds;
  detailBand: DetailBand;
  cursor?: string;
}

interface MapPresentation {
  camera: MapCamera;
  representationId: string;
}

type ViewFilterDefinition =
  | { kind: 'boolean'; id: string; label: string; defaultValue: boolean }
  | {
      kind: 'single';
      id: string;
      label: string;
      options: readonly [FilterOption, ...FilterOption[]];
      defaultValue: string;
    }
  | {
      kind: 'multiple';
      id: string;
      label: string;
      options: readonly [FilterOption, ...FilterOption[]];
      defaultValue: readonly string[];
    };

interface FilterOption {
  value: string;
  label: string;
}

type ResolvedContentRef =
  | {
      kind: 'transit-system';
      id: string;
      revision:
        | { kind: 'working'; contentDigest: ContentDigest }
        | { kind: 'published'; systemRevisionId: string };
    }
  | {
      kind: 'transit-dataset';
      id: string;
      datasetRevisionId: string;
      operational: { kind: 'planned' } | { kind: 'snapshot'; operationalSnapshotId: string };
    };

interface ContentMapDefinition {
  defaultRepresentationId: string;
  representationIds: readonly [string, ...string[]];
  modeIds: readonly string[];
  defaultModeIds: readonly string[];
  filters: readonly ViewFilterDefinition[];
}

interface ResolvedContentDescriptor {
  content: ResolvedContentRef;
  map: ContentMapDefinition;
  attributions: readonly Attribution[];
  licenses: readonly LicenseRef[];
  sources: readonly ResolvedSourceStatus[];
}

interface ResolvedSourceStatus {
  sourceId: string;
  name: string;
  attribution: Attribution;
  lastUpdatedAt?: string;
  freshness: 'fresh' | 'stale' | 'not-applicable' | 'unknown';
}
```

The `content-query-v1` structural parser applies fixed limits before a content
provider runs. Content, revision, representation, mode, filter, option, and
Source IDs contain from 1 through 128 UTF-8 bytes. Source names and
user-facing filter or option labels contain from 1 through 256 UTF-8 bytes. A
filter string contains at most 512 UTF-8 bytes. A map definition contains at
most 32 representations, 64 modes, 64 filters, and 256 options per filter. A
query contains at most 64 selected modes, 64 filter entries, and 128 values in
one multiple-choice filter. These limits count encoded UTF-8 bytes rather than
JavaScript code units.

Map-definition IDs and option values are unique within their owning lists.
The default representation belongs to `representationIds`.
`defaultModeIds` contains unique members of `modeIds`. Filter IDs are unique.
A single-choice default belongs to its options. Multiple-choice defaults are
unique and belong to their options. Definitions preserve declared order for
UI display.

Query parsing preserves unknown representation, mode, filter, and option IDs
for later content-aware fallback. It rejects duplicate mode IDs and duplicate
values inside one array filter. An empty string remains a valid filter value
for lossless schema-v1 View conversion; the nonblank rule applies to IDs,
names, and labels rather than user filter payloads. An instant uses RFC 3339
with an explicit `Z` or numeric offset.

`LngLat` accepts finite longitude from -180 through 180 and latitude from -90
through 90. Bounds require `south < north`. Ordinary bounds require
`west < east`; antimeridian bounds require `west > east`. Equal edges are
invalid. A polygon ring closes only when its final coordinate exactly equals
its first coordinate. It has at least three distinct pre-closure vertices and
a nonzero planar shoelace sum. Version 1 imposes no winding order and does not
attempt self-intersection or hole-containment repair. Every ring coordinate
still passes `LngLat` validation.

Map camera center uses the same coordinate rule. Zoom, bearing, and pitch must
be finite. The structural parser preserves their values; the active map
adapter applies its own supported display range. Representation ID remains
nonblank and provider-neutral.

`network-query-v1` is the canonical cursor and cache comparison value. It is
the `canonical-value-v1` encoding of `{ version: 'network-query-v1', content,
query }` after removing `query.cursor` and sorting copies of selected mode IDs
and array filter values by unsigned UTF-8 bytes. The parser does not mutate the
stored or user-visible order. Object keys use the canonical value encoder's
unsigned UTF-8 order. The opaque cursor also retains the provider's evaluation
instant for a `live` query and the accepted Line order; subsequent pages must
match all three values.

The map transfer separates stable entities, stable relationships, and clipped
geometry fragments. That shape keeps a Line or Pattern stable when geometry
crosses a cache boundary.

```ts
interface ResolvedLine {
  id: string;
  name?: string;
  publicCode?: string;
  color?: string;
}

interface ResolvedServicePlan {
  id: string;
  name?: string;
  mode: KnownOrUnknown<string>;
  vehicleKindId?: string;
  activity: 'active' | 'inactive' | 'unknown';
}

interface ResolvedPattern {
  id: string;
  direction?: PatternDirection;
  path: 'known' | 'unknown';
}

interface ResolvedStop {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
  stationId?: string;
  major: boolean;
}

interface ResolvedStation {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
}

interface ResolvedAlignment {
  id: string;
}

interface ResolvedWay {
  id: string;
  alignmentId: string;
  alignmentExtent: readonly [number, number];
  typeId: string;
  grade: Grade;
  profile: CrossSection;
  classId?: string;
}

interface LineServicePlanLink {
  id: string;
  lineId: string;
  servicePlanId: string;
}

interface ServicePlanPatternLink {
  id: string;
  servicePlanId: string;
  patternId: string;
}

interface ResolvedPatternStopCall {
  id: string;
  patternId: string;
  stopId: string;
  sequence: number;
  service: 'served' | 'skipped' | 'unknown';
  pathAnchor?: {
    legIndex: number;
    carrierPosition: number;
  };
}

interface ResolvedCarrierFragment {
  id: string;
  carrier: TransitCarrierRef;
  alignmentId: string;
  alignmentRange: readonly [number, number];
  points: readonly [LngLat, LngLat, ...LngLat[]];
  geometry: LineGeometry;
  curveControls: readonly CurveControl[];
}

interface ResolvedPatternLegFragment {
  id: string;
  logicalPatternLegFragmentId: string;
  patternId: string;
  legIndex: number;
  carrierFragmentId: string;
  carrierRange: readonly [number, number];
  logicalCarrierRange: readonly [number, number];
  logicalAlignmentRange: readonly [number, number];
  direction: LegDirection;
}

interface ResolvedTopologyWindowCall {
  stopCallId: string;
  patternLegBoundaryIndex: number;
}

interface ResolvedTopologyWindow {
  id: string;
  patternId: string;
  anchoredCalls: readonly [
    ResolvedTopologyWindowCall,
    ResolvedTopologyWindowCall,
    ...ResolvedTopologyWindowCall[],
  ];
  patternLegFragmentIds: readonly [string, ...string[]];
}

interface ResolvedSourceEvidence {
  sourceIds: readonly [string, ...string[]];
  sourceRevisionIds: readonly [string, ...string[]];
  lastUpdatedAt?: string;
}

interface ResolvedAdvisory {
  id: string;
  affected: readonly TransitEntityRef[];
  scope?: OperationalScope;
  cause?: string;
  effect?: string;
  text: readonly LocalizedAdvisoryText[];
  source: ResolvedSourceEvidence;
}

interface ResolvedOperationalChange {
  id: string;
  kind:
    'shuttle' | 'detour' | 'skipped-stop' | 'cancelled' | 'suspended' | 'schedule-change' | 'other';
  label: string;
  affected: readonly TransitEntityRef[];
  scope: OperationalScope;
  replacements: readonly ResolvedReplacementLink[];
  source: ResolvedSourceEvidence;
}

interface ResolvedServicePlanStatus {
  lineId: string;
  servicePlanId: string;
  activity: 'active' | 'inactive' | 'unknown';
  scope?: OperationalScope;
  replacements: readonly ResolvedReplacementLink[];
  source?: ResolvedSourceEvidence;
}

interface ResolvedFacility {
  id: string;
  typeId: string;
  name?: string;
  location?: LngLat;
}

interface ResolvedGroup {
  id: string;
  name?: string;
  color?: string;
}

interface ResolvedAreaFragment {
  id: string;
  owner: { kind: 'station' | 'facility' | 'group'; id: string };
  polygon: GeographicPolygon;
}

interface ResolvedReplacementLink {
  id: string;
  replacement: TransitEntityRef;
  target: TransitEntityRef;
}

interface ResolvedGroupMemberLink {
  id: string;
  groupId: string;
  member: TransitEntityRef;
}

interface ResolvedNode {
  id: string;
  location: KnownOrUnknown<LngLat>;
  wayPoints: readonly { wayId: string; pointIndex: number }[];
  controlId?: string;
}

interface ResolvedNamedWay {
  id: string;
  name: string;
  wayIds: readonly [string, ...string[]];
}

interface ResolvedMedian {
  id: string;
  namedWayId: string;
  widthMeters: number;
  kindId: string;
}

interface ResolvedLaneConnector {
  id: string;
  nodeId: string;
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

interface ResolvedTurnRestriction {
  id: string;
  from: { wayId: string; laneIds: Applicability<string> };
  to: { wayId: string; laneIds: Applicability<string> };
  via: { kind: 'node'; nodeId: string } | { kind: 'ways'; wayIds: readonly [string, ...string[]] };
  movement: 'prohibited' | 'only';
  modeIds: Applicability<string>;
}

interface ResolvedApproachControl {
  id: string;
  nodeId: string;
  wayId: string;
  end: 'start' | 'end';
  controlId: string;
}

interface ResolvedInfrastructureChunk {
  nodes: readonly ResolvedNode[];
  namedWays: readonly ResolvedNamedWay[];
  medians: readonly ResolvedMedian[];
  laneConnectors: readonly ResolvedLaneConnector[];
  turnRestrictions: readonly ResolvedTurnRestriction[];
  approachControls: readonly ResolvedApproachControl[];
  facilities: readonly ResolvedFacility[];
  groups: readonly ResolvedGroup[];
  groupMembers: readonly ResolvedGroupMemberLink[];
  areas: readonly ResolvedAreaFragment[];
}

interface ResolvedNetworkChunk {
  id: string;
  entities: {
    lines: readonly ResolvedLine[];
    servicePlans: readonly ResolvedServicePlan[];
    patterns: readonly ResolvedPattern[];
    stops: readonly ResolvedStop[];
    stations: readonly ResolvedStation[];
    alignments: readonly ResolvedAlignment[];
    ways: readonly ResolvedWay[];
  };
  relationships: {
    lineServicePlans: readonly LineServicePlanLink[];
    servicePlanPatterns: readonly ServicePlanPatternLink[];
    patternStopCalls: readonly ResolvedPatternStopCall[];
    topologyWindows: readonly ResolvedTopologyWindow[];
    replacements: readonly ResolvedReplacementLink[];
  };
  geometry: {
    carriers: readonly ResolvedCarrierFragment[];
    patternLegs: readonly ResolvedPatternLegFragment[];
    visiblePatternLegFragmentIds: readonly string[];
  };
  operationalChanges: readonly ResolvedOperationalChange[];
  advisories: readonly ResolvedAdvisory[];
  infrastructure: ResolvedInfrastructureChunk;
}
```

`ResolvedWay.alignmentExtent` owns the Way-to-Alignment correspondence. The
Way's normalized carrier range `[0, 1]` maps monotonically and affinely onto
that ascending Alignment range. A Way that cannot express its relationship as
one such mapping must split into several Ways before normalization. A Pattern,
ServicePlan, query shard, or renderer cannot define another mapping for the
same Way.

The contract evaluates that affine map with binary64 values in one fixed
order. For source range `[a, b]` and target range `[c, d]`, `M(a) = c` and
`M(b) = d` use endpoint short-circuits. Every interior value uses `progress =
(x - a) / (b - a)` followed by `c + progress * (d - c)`. An implementation
does not rearrange those operations. Core's `mapNormalizedRange` is the
reference implementation used by providers and consumers.

`ResolvedPatternLegFragment.id` identifies one transferred shard. A provider
may change that ID when a query clips one logical fragment into a different
visible extent. `logicalPatternLegFragmentId` identifies one semantic
Pattern-leg piece after leg, extent, and exact-anchor splitting but before
query clipping. `logicalCarrierRange` is that complete piece's normalized
range on its carrier. `logicalAlignmentRange` is the same complete piece's
derived range on its Alignment. For a Way carrier, the provider maps
`logicalCarrierRange` through `ResolvedWay.alignmentExtent`. For an Alignment
carrier, both ranges are equal. All three logical fields remain stable for
one `ResolvedContentRef` across bounds, pages, chunk subdivision, role, and
arrival order. Renderers use the logical fields for span assembly and stable
identity. They use `carrierRange` and the referenced transferred carrier for
the shard geometry that may paint in the current query.

All ranges contain finite normalized positions and satisfy
`0 <= start < end <= 1`. `carrierRange` is contained by
`logicalCarrierRange`. `alignmentRange` is contained by
`logicalAlignmentRange`. Every shard with one `logicalPatternLegFragmentId`
must agree exactly on `patternId`, `legIndex`, `direction`,
`logicalCarrierRange`, `logicalAlignmentRange`, the referenced carrier's
`carrier` value, and its `alignmentId`. The shards may differ in `id`,
`carrierFragmentId`, `carrierRange`, `alignmentRange`, points, and clipped curve
controls. A consumer rejects an assembly set that violates these invariants.
It does not index geometry by the logical ID because one logical piece may
produce several transferred shards. An Alignment carrier uses the same
parameterization for both identities, so its carrier and Alignment ranges must
match at both the shard and logical levels. A Way may use different ranges, but
every shard's `alignmentRange` and every logical piece's
`logicalAlignmentRange` must equal the affine image of its carrier range under
the Way-owned mapping. A consumer rejects a reversal, endpoint mismatch,
invalid Way extent, or occurrence-owned mapping before overlap assembly. Query
clipping may leave disconnected shards or no visible shard for a semantic
piece. Those conditions do not invalidate the piece.

For a duplicate entity, relationship, or transferred shard ID across chunks or pages,
the `canonical-value-v1` bytes of the complete record must match. Hosts
deduplicate by ID and reject a repeated ID with different bytes. Logical
fragment IDs and ranges remain stable for one `ResolvedContentRef`. Chunk
subdivision, cursor order, and arrival order cannot change assembly. Cache storage may put
one indivisible value in an overflow artifact instead of exceeding its object
target. That descriptor and its storage locator remain private to the cache.
The content provider dereferences the object and returns the semantic value in
an ordinary page, so `ResolvedNetworkChunk` and `NetworkQueryResult` never
contain R2 descriptors, object keys, signed URLs, or other storage values.
`ResolvedPatternStopCall.pathAnchor` locates supplied semantic evidence on the
complete carrier. A provider includes the nearest preceding and following
anchored calls for each visible known Pattern leg even when those lightweight
calls lie outside the query bounds. It also includes the referenced Stop and
optional parent Station identities. Their locations may remain outside the
visible bounds. Neither the renderer nor the map may snap a Stop to nearby
geometry to invent an anchor. Missing bounding anchors defer topology-only
overlap instead of producing a guessed bundle.

`ResolvedTopologyWindow` lists every ordered Pattern-leg fragment and every
supplied anchored call in one complete interval. Each call records the number
of listed fragments before its path boundary. The first boundary index is zero,
and the last equals `patternLegFragmentIds.length`. Interior indexes never
decrease. Every index is a nonnegative safe integer no greater than the
fragment count. `anchoredCalls` follows strictly increasing Pattern stop-call
sequence, and one call ID appears at most once per window. Several calls may
share a boundary. Each named call resolves to a path-anchored call on the
window's Pattern. The call record owns Stop identity, sequence, service, and
carrier position. The window owns only membership and fragment-boundary
placement. This explicit relation places a call collapsed at a leg transition
without asking the renderer to infer its position from geometry. Listed carrier
geometry covers the complete anchor-to-anchor interval rather than a viewport
clip. A provider returns each window that intersects a visible known Pattern
leg. It may page the listed fragments. Its cache may store one indivisible
window in an overflow object, but the provider resolves that object before
transfer. The complete fragment and call lists let the renderer detect missing
evidence. The renderer defers topology-only overlap until every listed record
has arrived.
`visiblePatternLegFragmentIds` is the only set that authorizes route paint,
hits, or export. A topology window does not add offscreen paint, hits, labels,
or export geometry.

A bounded result includes the complete same-Line semantic carrier closure for
every carrier selected by the query. Once one Pattern fragment makes a Line
visible on a selected carrier, the provider also returns each logical fragment
from the Line's other selected ServicePlans that occupies that carrier. It
returns the required Line, ServicePlan, Pattern, Alignment, Way, and membership
facts with those fragments. A closure-only fragment may use complete topology
geometry outside the visible bounds. Its ID never appears in
`visiblePatternLegFragmentIds`. A provider does not pull an unrelated carrier
from the same Pattern, another Line that happens to use the carrier, or a
ServicePlan excluded by the query. This bounded semantic closure lets a
per-Line renderer keep exact span boundaries stable while a user pans. A
provider may page the closure, and `nextCursor` tells the renderer not to fix
those boundaries yet.

The renderer may normalize every transferred logical fragment, including
topology-window evidence. It creates an exact `(Line, carrier)` group only when
that group contains at least one ID from `visiblePatternLegFragmentIds`. Once
the visible fragment seeds the group, every closure-only contributor remains
part of its semantic boundaries. A carrier supplied only for a topology window
does not become an incomplete exact group.

`alignmentRange` uses normalized positions on the complete Alignment.
`curveControls` use point indexes local to the fragment's `points` array. A
provider clips and remaps them before transfer, so a renderer never applies a
full-alignment index to clipped geometry. A carrier's `points` advance in its
ascending carrier range. Straight and freeform fragments carry path vertices.
Curved fragments carry local control vertices and local controls. A renderer
resolves a curved transferred fragment with the core metric-curve algorithm at
a 0.25-metre sagitta before it clips a visible Line fragment.

One query result carries status and display order independently of chunk
arrival:

```ts
interface CoverageAssessment {
  area: GeographicCoverage;
  sourceIds: readonly string[];
  coverage: 'inside' | 'outside' | 'unknown';
  availability: 'available' | 'unavailable' | 'unknown';
  freshness: 'fresh' | 'stale' | 'not-applicable' | 'unknown';
  serviceEvidence: 'present' | 'known-none' | 'unknown';
  filterEffect: 'included' | 'excluded' | 'partial' | 'not-applied';
}

interface NetworkQueryResult {
  descriptor: ResolvedContentDescriptor;
  coverage: readonly CoverageAssessment[];
  lineOrder: readonly LineOrderEntry[];
  chunks: readonly ResolvedNetworkChunk[];
  nextCursor?: string;
}

interface ResolveOptions {
  signal?: AbortSignal;
}

interface ContentProvider {
  describe(reference: ContentRef, options?: ResolveOptions): Promise<ResolvedContentDescriptor>;
  resolve(
    content: ResolvedContentRef,
    query: NetworkQuery,
    options?: ResolveOptions,
  ): Promise<NetworkQueryResult>;
}
```

A saved View stores `ViewQuery`. The map host combines it with current visible
bounds and derived detail to create `NetworkQuery`. The provider evaluates the
runtime query. A remote provider can push bounds, service time, mode, and detail
into indexed storage. The renderer receives the resolved result and
`MapPresentation`. It does not decide which facts to fetch.

When a result supplies `nextCursor`, the host sends that opaque value back with
the same concrete content identity and semantic query. A cursor cannot change
bounds, service time, filters, detail, or Line order. A provider rejects a
cursor used with another content identity or query. `AbortSignal` cancels
superseded describe, resolve, search, and details work.

Search and timetable details use separate ports. They do not enlarge the
renderer transfer with every Trip or Schedule.

```ts
interface ContentSearchQuery {
  text: string;
  bounds?: GeographicBounds;
  kinds?: readonly TransitEntityRef['kind'][];
  limit: number;
  cursor?: string;
}

interface ContentSearchItem {
  entity: TransitEntityRef;
  label: string;
  location?: LngLat;
  extent?: GeographicBounds;
}

interface ContentSearchResult {
  items: readonly ContentSearchItem[];
  nextCursor?: string;
}

interface EntityDetailsQuery {
  entity: TransitEntityRef;
  serviceTime: ViewQuery['serviceTime'];
  window?: InstantRange;
  limit: number;
  cursor?: string;
}

interface CalendarSummary {
  id: string;
  timeZone: ServiceTimeZone;
  dateRange: ServiceDateRange;
}

interface TripSummary {
  id: string;
  patternId: string;
  calendarId: string;
  serviceDate: string;
  startTimeSeconds?: number;
}

interface FrequencySummary {
  id: string;
  patternId: string;
  calendarId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  headwaySeconds: number;
  precision: 'exact' | 'headway' | 'unknown';
}

interface StopCallSummary {
  id: string;
  tripId?: string;
  patternId: string;
  stopId: string;
  sequence: number;
  arrivalSeconds?: number;
  departureSeconds?: number;
  precision: 'exact' | 'estimated' | 'unknown';
  pickup: BoardingRule;
  dropOff: BoardingRule;
  service: 'served' | 'skipped' | 'unknown';
}

type EntityDetailItem =
  | { kind: 'calendar'; value: CalendarSummary }
  | { kind: 'trip'; value: TripSummary }
  | { kind: 'frequency'; value: FrequencySummary }
  | { kind: 'stop-call'; value: StopCallSummary }
  | { kind: 'service-plan-status'; value: ResolvedServicePlanStatus }
  | { kind: 'operational-change'; value: ResolvedOperationalChange }
  | { kind: 'advisory'; value: ResolvedAdvisory };

interface EntityDetailsResult {
  entity: TransitEntityRef;
  label: string;
  items: readonly EntityDetailItem[];
  nextCursor?: string;
}

interface ContentSearchProvider {
  search(
    content: ResolvedContentRef,
    query: ContentSearchQuery,
    options?: ResolveOptions,
  ): Promise<ContentSearchResult>;
}

interface EntityDetailsProvider {
  details(
    content: ResolvedContentRef,
    query: EntityDetailsQuery,
    options?: ResolveOptions,
  ): Promise<EntityDetailsResult>;
}

type TransitApiVersion = 'transit-network-v1';

interface TransitApiRequest<Value> {
  version: TransitApiVersion;
  value: Value;
}

interface TransitApiSuccess<Value> {
  version: TransitApiVersion;
  result: Value;
}

interface TransitApiError {
  code:
    | 'invalid-request'
    | 'unsupported-version'
    | 'content-not-found'
    | 'revision-not-found'
    | 'content-unavailable'
    | 'invalid-cursor'
    | 'revision-conflict'
    | 'internal';
  message: string;
  retryable: boolean;
}

interface TransitApiFailure {
  version: TransitApiVersion;
  error: TransitApiError;
}

type TransitApiResponse<Value> = TransitApiSuccess<Value> | TransitApiFailure;

interface DescribeContentRequest {
  reference: ContentRef;
}

interface NetworkPageRequest {
  content: ResolvedContentRef;
  query: NetworkQuery;
}

interface SearchPageRequest {
  content: ResolvedContentRef;
  query: ContentSearchQuery;
}

interface EntityDetailPageRequest {
  content: ResolvedContentRef;
  query: EntityDetailsQuery;
}
```

The summary values are bounded passenger-facing projections. They are not
aliases for full stored records. One discriminated item stream defines page
order across all detail kinds. The provider enforces the request limit and
uses a cursor for another page.

The Worker owns four versioned resource routes. Each route accepts JSON and
returns JSON. The client rejects a response whose version does not match its
request.

| Method | Resource path                       | Request value             | Success result              |
| ------ | ----------------------------------- | ------------------------- | --------------------------- |
| `POST` | `/api/transit/content-descriptions` | `DescribeContentRequest`  | `ResolvedContentDescriptor` |
| `POST` | `/api/transit/network-pages`        | `NetworkPageRequest`      | `NetworkQueryResult`        |
| `POST` | `/api/transit/search-pages`         | `SearchPageRequest`       | `ContentSearchResult`       |
| `POST` | `/api/transit/entity-detail-pages`  | `EntityDetailPageRequest` | `EntityDetailsResult`       |

The request body is `TransitApiRequest<RequestValue>`. The response body is
`TransitApiResponse<SuccessResult>`. An invalid request or cursor returns 400.
Missing content or revisions return 404. A revision conflict returns 409.
Known temporary unavailability returns 503 only when retrying can succeed.
Every other internal failure returns 500. Failure responses contain no cursor
and no partial result. A cursor is opaque, concrete-content-bound, and valid
only for the canonical query that created it.

An empty chunk does not prove that an area has no transit. The viewer can make
that claim only when the coverage report says `serviceEvidence: 'known-none'`.
Coverage, availability, freshness, service evidence, and filtering remain
separate. Line order comes from the resolved content. Authored content uses the
explicit order of `TransitSystem.lines`. Source-backed content uses the order
recorded by its Dataset builder. The renderer never derives it from chunk or
object order.

The network resolver applies Calendars, Schedules, and OperationalChanges
before it creates a renderer input. The renderer may receive effective service
state and Advisories. It does not resolve calendars or provider authority.
`ResolvedServicePlanStatus` belongs to paged entity details. Chunk-level
operational summary uses `ResolvedServicePlan.activity`,
`ResolvedOperationalChange`, and `ResolvedAdvisory`; it does not add a second
ServicePlan status collection.

The shared `RenderScene`, patch, feature ID, and identity protocols live in a
dependency-leaf contract module. Persisted transit modules do not import that
module. This keeps the core package from turning into a renderer dependency
bucket.

Target-schema scalar and structural values live in the dependency-leaf
`packages/core/src/transit/value-types.ts` module. Network transfer, authored
schema v17, normalized content, and operational content may import it. That
module never imports a provider, storage adapter, renderer, or the incompatible
schema-v16 value records.

## Implementation types

The following types remain private to their owning module:

- Raw GTFS rows, protocol buffers, MBTA response objects, and OpenStreetMap
  elements belong to source adapters.
- D1 rows, R2 object metadata, and IndexedDB records belong to storage
  adapters.
- React state, Zustand state, and editor commands belong to application
  composition.
- MapLibre sources, layers, and feature-state values belong to the map
  adapter.
- `RenderScene` drafts and spatial indexes belong to the renderer.

An implementation type may convert into a boundary or domain type. It cannot
become a public alias for that type. This rule prevents a provider, database,
or map-library upgrade from changing the core API.

## Content references

The target `ContentRef` is a discriminated union with two content kinds:

```ts
type ContentRef =
  | {
      kind: 'transit-system';
      id: string;
      revision: { kind: 'latest' } | { kind: 'pinned'; systemRevisionId: string };
    }
  | {
      kind: 'transit-dataset';
      id: string;
      revision:
        | {
            kind: 'latest';
            operational: { kind: 'planned' } | { kind: 'latest' };
          }
        | {
            kind: 'pinned';
            datasetRevisionId: string;
            operational:
              | { kind: 'planned' }
              | { kind: 'latest' }
              | { kind: 'pinned'; operationalSnapshotId: string };
          };
    };
```

The API wire envelope uses `transit-network-v1` and carries this union without
changing its branches. A string ID with an implied content kind is not
sufficient. Operational selection is always explicit.
`planned` ignores OperationalSnapshots. `latest` applies
`operational-latest-v1` to the resolved Dataset revision. `pinned` reproduces
the exact effective-service inputs from one immutable Snapshot. A reproducible
View also uses a fixed service instant. Validation rejects a pinned Snapshot
whose base Dataset revision does not match the reference. The host resolves
every `latest` selector to concrete revision IDs before it builds cache keys.

## Dependency direction

The type dependency direction is one-way:

```text
provider and storage types
        ↓ convert
source and transit domain types
        ↓ resolve
network transfer types
        ↓ project
renderer types
        ↓ publish
map-library types
```

No arrow points upward. Core transit facts never import a transfer, renderer,
map, database, or provider type.
