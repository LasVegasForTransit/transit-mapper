import type { TransitSystem as SchemaV16TransitSystem } from '../system';
import type { TransitSystem as SchemaV17TransitSystem } from '../../transit/authored-system';

export type SchemaV16MigrationIssue =
  | { code: 'missing-legacy-line-membership'; serviceId: string }
  | { code: 'duplicate-legacy-line-membership'; serviceId: string; lineIds: string[] }
  | { code: 'invalid-legacy-line-membership'; lineId?: string; serviceId?: string }
  | { code: 'invalid-legacy-leg-extent'; serviceId: string; wayId: string }
  | { code: 'invalid-legacy-service-time'; serviceId: string }
  | { code: 'invalid-legacy-headway'; serviceId: string };

export type SchemaV16MigrationResult =
  | { kind: 'migrated'; system: SchemaV17TransitSystem }
  | { kind: 'incompatible'; system: SchemaV16TransitSystem; issues: SchemaV16MigrationIssue[] };
