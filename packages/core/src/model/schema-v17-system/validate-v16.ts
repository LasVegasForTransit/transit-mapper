import { patternLegs } from '../geo/servicePaths';
import { validateLineServiceMembership } from '../line-service';
import type { PatternLeg, TransitSystem } from '../system';
import { parseHhMm } from '../../transit/service-time';
import type { SchemaV16MigrationIssue } from './migration-types';

export function schemaV16MigrationIssues(system: TransitSystem): SchemaV16MigrationIssue[] {
  return [...membershipIssues(system), ...valueIssues(system)];
}

function membershipIssues(system: TransitSystem): SchemaV16MigrationIssue[] {
  return validateLineServiceMembership(system).flatMap<SchemaV16MigrationIssue>((issue) => {
    if (issue.kind === 'orphaned-service' || issue.kind === 'missing-service') {
      return [{ code: 'missing-legacy-line-membership', serviceId: issue.serviceId }];
    }
    if (issue.kind === 'duplicate-membership') {
      return [
        {
          code: 'duplicate-legacy-line-membership',
          serviceId: issue.serviceId,
          lineIds: [...issue.lineIds],
        },
      ];
    }
    if (issue.kind === 'empty-line' || issue.kind === 'duplicate-line-id') {
      return [{ code: 'invalid-legacy-line-membership', lineId: issue.lineId }];
    }
    return [{ code: 'invalid-legacy-line-membership', serviceId: issue.serviceId }];
  });
}

function valueIssues(system: TransitSystem): SchemaV16MigrationIssue[] {
  return system.services.flatMap((service) => {
    const issues: SchemaV16MigrationIssue[] = [];
    for (const leg of patternLegs(service.path)) {
      if (invalidLegacyLegExtent(leg)) {
        issues.push({ code: 'invalid-legacy-leg-extent', serviceId: service.id, wayId: leg.wayId });
      }
    }
    if (service.frequencyMinutes !== undefined && !validHeadwayMinutes(service.frequencyMinutes)) {
      issues.push({ code: 'invalid-legacy-headway', serviceId: service.id });
    }
    if (
      (service.spanStart !== undefined && !validServiceTime(service.spanStart)) ||
      (service.spanEnd !== undefined && !validServiceTime(service.spanEnd))
    ) {
      issues.push({ code: 'invalid-legacy-service-time', serviceId: service.id });
    }
    for (const period of service.schedule ?? []) {
      if (!validHeadwayMinutes(period.frequencyMinutes)) {
        issues.push({ code: 'invalid-legacy-headway', serviceId: service.id });
      }
      if (!validServiceTime(period.spanStart) || !validServiceTime(period.spanEnd)) {
        issues.push({ code: 'invalid-legacy-service-time', serviceId: service.id });
      }
    }
    return issues;
  });
}

function invalidLegacyLegExtent(leg: PatternLeg): boolean {
  if (leg.extent.kind === 'whole') return false;
  const { fromT, toT } = leg.extent;
  return (
    !Number.isFinite(fromT) ||
    !Number.isFinite(toT) ||
    fromT < 0 ||
    fromT > 1 ||
    toT < 0 ||
    toT > 1 ||
    fromT === toT
  );
}

function validServiceTime(value: string): boolean {
  return parseHhMm(value) !== null;
}

function validHeadwayMinutes(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isSafeInteger(value * 60);
}
