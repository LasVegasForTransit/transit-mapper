import type { TransitSystem as SchemaV16TransitSystem } from '../system';
import { migrateCompatibleSystem } from './migrate-document';
import { type SchemaV16MigrationIssue, type SchemaV16MigrationResult } from './migration-types';
import { validateAuthoredInfrastructureRelationships } from './validate-infrastructure-relationships';
import { validateAuthoredPassengerRelationships } from './validate-passenger-relationships';
import { schemaV16MigrationIssues } from './validate-v16';

export type { SchemaV16MigrationIssue, SchemaV16MigrationResult } from './migration-types';

/**
 * Projects a parsed schema-v16 document into the authored v17 shape. It never
 * changes storage or selects a new runtime path, so an incompatible document
 * remains available to the v16 reader. The v16 decoder has already normalized
 * historical raw extents before this boundary, so this validates the document
 * form that the existing application has always used.
 */
export function migrateSchemaV16System(system: SchemaV16TransitSystem): SchemaV16MigrationResult {
  const issues: SchemaV16MigrationIssue[] = schemaV16MigrationIssues(system);
  if (issues.length > 0) return { kind: 'incompatible', system, issues };
  const migrated = migrateCompatibleSystem(system);
  validateAuthoredInfrastructureRelationships(migrated);
  validateAuthoredPassengerRelationships(migrated);
  return { kind: 'migrated', system: migrated };
}
