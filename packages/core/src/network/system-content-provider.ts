import { migrateSchemaV16System } from '../model/schema-v17-system/migrate-v16';
import type { SchemaV16MigrationIssue } from '../model/schema-v17-system/migration-types';
import type { TransitSystem as SchemaV16TransitSystem } from '../model/system';
import type { ContentProvider } from './content-provider';
import { createSchemaV16SystemProvider } from './schema-v16-system-provider';
import { createSchemaV17SystemProvider } from './schema-v17-system-provider';

export interface SystemContentProviderResult {
  readonly provider: ContentProvider;
  /** Which document shape actually answers, so a host can say so rather than
   * inferring it from behaviour. */
  readonly schema: 16 | 17;
  /** Why v17 was declined. Empty when the document migrated. */
  readonly issues: readonly SchemaV16MigrationIssue[];
}

/**
 * Chooses the provider a stored v16 document can actually be served by.
 *
 * A document that cannot migrate is served by the v16 provider rather than
 * refused: the person who authored it must still be able to open their map,
 * and the migration issues are the thing to show them. Falling back silently
 * would be worse than either — a host could not tell a v17 answer from a v16
 * one, and the two disagree about what a Line is.
 */
export function createSystemContentProvider(
  system: SchemaV16TransitSystem,
): SystemContentProviderResult {
  const migration = migrateSchemaV16System(system);
  if (migration.kind === 'migrated') {
    return { provider: createSchemaV17SystemProvider(migration.system), schema: 17, issues: [] };
  }
  return {
    provider: createSchemaV16SystemProvider(migration.system),
    schema: 16,
    issues: migration.issues,
  };
}
