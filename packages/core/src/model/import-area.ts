import type { ImportBBox, ImportedNetwork } from './import';
import { withoutAlreadyImported } from './import';

const EARTH_RADIUS_KM = 6371.0088;
const MAX_TILE_AREA_KM2 = 100;
const MIN_TILE_AREA_KM2 = 1;
const MAX_TILE_SIDE_KM = Math.sqrt(MAX_TILE_AREA_KM2);

const emptyNetwork = (): ImportedNetwork => ({
  ways: [],
  nodes: [],
  namedWays: [],
  medians: [],
  turnRestrictions: [],
});

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

const wrappedLongitude = (longitude: number): number =>
  ((((longitude + 180) % 360) + 360) % 360) - 180;

/**
 * Convert MapLibre bounds from its continuous world-copy coordinates into
 * the canonical OSM rectangle representation. A viewport may legitimately
 * report 170..190 around the antimeridian; imports express that as 170..-170.
 * More than one whole world cannot be represented as one bounded import.
 */
export function normalizeImportBounds(bounds: ImportBBox): ImportBBox | undefined {
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
    bounds.south < -90 ||
    bounds.north > 90 ||
    bounds.south >= bounds.north
  ) {
    return undefined;
  }
  if (
    bounds.west >= -180 &&
    bounds.west <= 180 &&
    bounds.east >= -180 &&
    bounds.east <= 180 &&
    bounds.west !== bounds.east
  ) {
    return bounds;
  }
  const span = bounds.east - bounds.west;
  if (span <= 0 || span >= 360) return undefined;
  const west = wrappedLongitude(bounds.west);
  const wrappedEast = wrappedLongitude(bounds.east);
  const east = wrappedEast === -180 && bounds.east > 0 ? 180 : wrappedEast;
  if (west === east) return undefined;
  return { west, south: bounds.south, east, north: bounds.north };
}

function orderedSegments(bounds: ImportBBox): ImportBBox[] {
  if (bounds.west < bounds.east) return [bounds];
  return [
    { ...bounds, east: 180 },
    { ...bounds, west: -180 },
  ];
}

/** Spherical area of a latitude/longitude rectangle, including one crossing the antimeridian. */
export function importAreaKm2(bounds: ImportBBox): number {
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
    bounds.south >= bounds.north ||
    bounds.south < -90 ||
    bounds.north > 90 ||
    bounds.west < -180 ||
    bounds.west > 180 ||
    bounds.east < -180 ||
    bounds.east > 180 ||
    bounds.west === bounds.east
  ) {
    return 0;
  }
  return orderedSegments(bounds).reduce((sum, segment) => {
    const longitude = radians(segment.east - segment.west);
    const latitude = Math.sin(radians(segment.north)) - Math.sin(radians(segment.south));
    return sum + EARTH_RADIUS_KM * EARTH_RADIUS_KM * longitude * latitude;
  }, 0);
}

/** Deterministically cover an area with ordered requests no larger than 100 km². */
export function tileImportArea(bounds: ImportBBox): ImportBBox[] {
  if (importAreaKm2(bounds) === 0) return [];
  const tiles: ImportBBox[] = [];
  for (const segment of orderedSegments(bounds)) {
    const heightKm = EARTH_RADIUS_KM * radians(segment.north - segment.south);
    const widestLatitude = Math.min(Math.abs(segment.south), Math.abs(segment.north));
    const widthKm =
      EARTH_RADIUS_KM * radians(segment.east - segment.west) * Math.cos(radians(widestLatitude));
    const rows = Math.max(1, Math.ceil(heightKm / MAX_TILE_SIDE_KM));
    const columns = Math.max(1, Math.ceil(widthKm / MAX_TILE_SIDE_KM));
    const latitudeStep = (segment.north - segment.south) / rows;
    const longitudeStep = (segment.east - segment.west) / columns;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        tiles.push({
          west: segment.west + longitudeStep * column,
          south: segment.south + latitudeStep * row,
          east: column === columns - 1 ? segment.east : segment.west + longitudeStep * (column + 1),
          north: row === rows - 1 ? segment.north : segment.south + latitudeStep * (row + 1),
        });
      }
    }
  }
  return tiles;
}

/** Quarter a failed tile; a tile at the one-square-kilometre floor is final. */
export function subdivideImportTile(tile: ImportBBox): ImportBBox[] {
  if (importAreaKm2(tile) <= MIN_TILE_AREA_KM2) return [];
  const middleLongitude = (tile.west + tile.east) / 2;
  const middleLatitude = (tile.south + tile.north) / 2;
  return [
    { west: tile.west, south: tile.south, east: middleLongitude, north: middleLatitude },
    { west: middleLongitude, south: tile.south, east: tile.east, north: middleLatitude },
    { west: tile.west, south: middleLatitude, east: middleLongitude, north: tile.north },
    { west: middleLongitude, south: middleLatitude, east: tile.east, north: tile.north },
  ];
}

export interface AppendedImportedNetworks {
  network: ImportedNetwork;
  addedWays: number;
  duplicateWays: number;
}

/**
 * Append imported networks through the same seam-aware identity and topology
 * reconciliation used for imports into an existing document.
 */
export function appendImportedNetworks(networks: ImportedNetwork[]): AppendedImportedNetworks {
  let combined = emptyNetwork();
  let duplicateWays = 0;
  for (const incoming of networks) {
    const deduped = withoutAlreadyImported(
      incoming,
      combined.ways,
      combined.namedWays,
      combined.nodes,
    );
    duplicateWays += deduped.duplicateWays;
    const identityAdditions = new Map(
      deduped.identityAdditions.map((entry) => [entry.id, entry.wayIds]),
    );
    const junctionAdditions = new Map(
      deduped.junctionAdditions.map((entry) => [entry.id, entry.refs]),
    );
    const incomingMedianIds = new Set(deduped.network.medians.map((entry) => entry.id));
    const incomingRestrictionKeys = new Set(
      deduped.network.turnRestrictions.map((entry) => entry.key),
    );
    combined = {
      ways: [...combined.ways, ...deduped.network.ways],
      nodes: [
        ...combined.nodes.map((node) => {
          const additions = junctionAdditions.get(node.id);
          return additions ? { ...node, refs: [...node.refs, ...additions] } : node;
        }),
        ...deduped.network.nodes,
      ],
      namedWays: [
        ...combined.namedWays.map((namedWay) => {
          const additions = identityAdditions.get(namedWay.id);
          return additions ? { ...namedWay, wayIds: [...namedWay.wayIds, ...additions] } : namedWay;
        }),
        ...deduped.network.namedWays,
      ],
      medians: [
        ...combined.medians.filter((entry) => !incomingMedianIds.has(entry.id)),
        ...deduped.network.medians,
      ],
      turnRestrictions: [
        ...combined.turnRestrictions.filter((entry) => !incomingRestrictionKeys.has(entry.key)),
        ...deduped.network.turnRestrictions,
      ],
    };
  }
  return { network: combined, addedWays: combined.ways.length, duplicateWays };
}
