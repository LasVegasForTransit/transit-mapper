import type { Service, TransitSystem as SchemaV16TransitSystem } from '../system';
import type {
  LegacyServiceAlias,
  ServicePlan,
  TransitSystem as SchemaV17TransitSystem,
} from '../../transit/authored-system';
import { migratedSystemBase } from './migrate-infrastructure';
import { migrateServicePatterns, type MigratedServicePatterns } from './migrate-patterns';
import { migrateServiceTiming, type MigratedServiceTiming } from './migrate-schedules';

interface MigratedService {
  service: Service;
  patterns: MigratedServicePatterns;
  timing: MigratedServiceTiming;
}

export function migrateCompatibleSystem(system: SchemaV16TransitSystem): SchemaV17TransitSystem {
  const services = system.services.map((service) => migrateService(system, service));
  const serviceById = new Map(services.map((migration) => [migration.service.id, migration]));

  return {
    version: 17,
    ...migratedSystemBase(system),
    lines: system.lines.map((line) => ({
      id: line.id,
      name: line.name,
      color: line.color,
      servicePlanIds: [...line.serviceIds],
    })),
    servicePlans: services.map(migrateServicePlan),
    patterns: services.flatMap((migration) => migration.patterns.patterns),
    schedules: services.flatMap((migration) => migration.timing.schedules),
    calendars: services.flatMap((migration) => migration.timing.calendars),
    trips: [],
    frequencyRules: services.flatMap((migration) => migration.timing.frequencyRules),
    legacyServiceAliases: migrateLegacyServiceAliases(system, serviceById),
  };
}

function migrateService(system: SchemaV16TransitSystem, service: Service): MigratedService {
  const patterns = migrateServicePatterns(service, system.stops);
  return { service, patterns, timing: migrateServiceTiming(service, patterns.ids) };
}

function migrateServicePlan(migration: MigratedService): ServicePlan {
  const { service, patterns, timing } = migration;
  return {
    id: service.id,
    ...(service.name === undefined ? {} : { name: service.name }),
    modeId: service.modeId,
    ...(service.vehicleKindId === undefined ? {} : { vehicleKindId: service.vehicleKindId }),
    patternIds:
      patterns.ids.inbound === undefined
        ? [patterns.ids.outbound]
        : [patterns.ids.outbound, patterns.ids.inbound],
    scheduleIds: timing.scheduleIds,
    ...(timing.planningSummary === undefined ? {} : { planningSummary: timing.planningSummary }),
  };
}

function migrateLegacyServiceAliases(
  system: SchemaV16TransitSystem,
  serviceById: ReadonlyMap<string, MigratedService>,
): LegacyServiceAlias[] {
  const lineIdByServiceId = new Map<string, string>();
  for (const line of system.lines) {
    for (const serviceId of line.serviceIds) lineIdByServiceId.set(serviceId, line.id);
  }

  return system.services.flatMap((service) => {
    const migration = serviceById.get(service.id);
    const lineId = lineIdByServiceId.get(service.id);
    if (!migration || !lineId) return [];
    return [
      {
        legacyServiceId: service.id,
        lineId,
        servicePlanId: service.id,
        patternIds: migration.patterns.ids,
      },
    ];
  });
}
