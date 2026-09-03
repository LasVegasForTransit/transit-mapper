import type { TransitSystem } from '../../transit/authored-system';
import {
  parseAlignment,
  parseApproachControls,
  parseFacility,
  parseGroup,
  parseMedians,
  parseNamedWay,
  parseNode,
  parseStation,
  parseStop,
  parseTurnRestrictions,
  parseVehicleKind,
  parseWay,
} from './parse-infrastructure-records';
import {
  parseCalendar,
  parseFrequencyRule,
  parseLine,
  parsePattern,
  parseSchedule,
  parseServicePlan,
  parseTrip,
} from './parse-passenger-records';
import {
  parseImportHistoryEntry,
  parseLegacyServiceAlias,
  parseLegacySourceReference,
  parseSourceBinding,
  parseSourceCitationRecord,
} from './parse-provenance-records';
import {
  exactRecord,
  parseArray,
  parseEnum,
  parseFiniteNumber,
  parseLngLat,
  parseNonnegativeInteger,
  parseText,
} from './parse-values';
import { validateAuthoredInfrastructureRelationships } from './validate-infrastructure-relationships';
import { validateAuthoredPassengerRelationships } from './validate-passenger-relationships';
import { validateAuthoredProvenanceRelationships } from './validate-provenance-relationships';

const REQUIRED_SYSTEM_FIELDS = [
  'version',
  'id',
  'name',
  'viewport',
  'createdAt',
  'updatedAt',
  'alignments',
  'ways',
  'lines',
  'servicePlans',
  'patterns',
  'schedules',
  'calendars',
  'trips',
  'frequencyRules',
  'stops',
  'stations',
  'facilities',
  'groups',
  'nodes',
  'namedWays',
  'vehicleKinds',
  'palette',
  'drivingSide',
  'turnRestrictions',
  'medians',
  'approachControls',
  'sourceCitations',
  'sourceBindings',
  'legacyServiceAliases',
  'legacySourceReferences',
  'importHistory',
] as const;

function parseViewport(value: unknown): TransitSystem['viewport'] {
  const record = exactRecord(value, 'System viewport', ['center', 'zoom']);
  return {
    center: parseLngLat(record.center, 'System viewport center'),
    zoom: parseFiniteNumber(record.zoom, 'System viewport zoom'),
  };
}

interface IdentifiedRecord {
  readonly id: string;
}

function requireUniqueIds(label: string, records: readonly IdentifiedRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`${label} repeats ID ${record.id}.`);
    ids.add(record.id);
  }
}

function validateRemainingCollectionIdentity(system: TransitSystem): void {
  requireUniqueIds('Facilities', system.facilities);
  requireUniqueIds('Groups', system.groups);
  requireUniqueIds('Import history', system.importHistory);
  const sourceIds = new Set<string>();
  for (const citation of system.sourceCitations) {
    if (sourceIds.has(citation.sourceId)) {
      throw new Error(`Source citations repeat Source ID ${citation.sourceId}.`);
    }
    sourceIds.add(citation.sourceId);
  }
}

/** Parses one portable schema-v17 document before any digest or host state is
 * attached. Unknown fields are rejected instead of being silently omitted. */
export function parseAuthoredSystem(value: unknown): TransitSystem {
  const record = exactRecord(value, 'Authored system', REQUIRED_SYSTEM_FIELDS, ['description']);
  if (record.version !== 17) throw new Error('Authored system version must be 17.');

  const system: TransitSystem = {
    version: 17,
    id: parseText(record.id, 'System ID'),
    name: parseText(record.name, 'System name'),
    viewport: parseViewport(record.viewport),
    createdAt: parseNonnegativeInteger(record.createdAt, 'System creation time'),
    updatedAt: parseNonnegativeInteger(record.updatedAt, 'System update time'),
    alignments: parseArray(record.alignments, 'Alignments', parseAlignment),
    ways: parseArray(record.ways, 'Ways', parseWay),
    lines: parseArray(record.lines, 'Lines', parseLine),
    servicePlans: parseArray(record.servicePlans, 'ServicePlans', parseServicePlan),
    patterns: parseArray(record.patterns, 'Patterns', parsePattern),
    schedules: parseArray(record.schedules, 'Schedules', parseSchedule),
    calendars: parseArray(record.calendars, 'Calendars', parseCalendar),
    trips: parseArray(record.trips, 'Trips', parseTrip),
    frequencyRules: parseArray(record.frequencyRules, 'FrequencyRules', parseFrequencyRule),
    stops: parseArray(record.stops, 'Stops', parseStop),
    stations: parseArray(record.stations, 'Stations', parseStation),
    facilities: parseArray(record.facilities, 'Facilities', parseFacility),
    groups: parseArray(record.groups, 'Groups', parseGroup),
    nodes: parseArray(record.nodes, 'Nodes', parseNode),
    namedWays: parseArray(record.namedWays, 'NamedWays', parseNamedWay),
    vehicleKinds: parseArray(record.vehicleKinds, 'VehicleKinds', parseVehicleKind),
    palette: parseArray(record.palette, 'Palette', parseText),
    drivingSide: parseEnum(record.drivingSide, 'Driving side', ['left', 'right'] as const),
    turnRestrictions: parseTurnRestrictions(record.turnRestrictions),
    medians: parseMedians(record.medians),
    approachControls: parseApproachControls(record.approachControls),
    sourceCitations: parseArray(
      record.sourceCitations,
      'Source citations',
      parseSourceCitationRecord,
    ),
    sourceBindings: parseArray(record.sourceBindings, 'Source bindings', parseSourceBinding),
    legacyServiceAliases: parseArray(
      record.legacyServiceAliases,
      'Legacy Service aliases',
      parseLegacyServiceAlias,
    ),
    legacySourceReferences: parseArray(
      record.legacySourceReferences,
      'Legacy source references',
      parseLegacySourceReference,
    ),
    importHistory: parseArray(record.importHistory, 'Import history', parseImportHistoryEntry),
  };
  if ('description' in record) {
    system.description = parseText(record.description, 'System description');
  }

  validateRemainingCollectionIdentity(system);
  validateAuthoredInfrastructureRelationships(system);
  validateAuthoredPassengerRelationships(system);
  validateAuthoredProvenanceRelationships(system);
  return system;
}
