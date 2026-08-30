import type { TransitSystem as SchemaV16TransitSystem } from '../system';
import type { TransitSystem as SchemaV17TransitSystem } from '../../transit/authored-system';
import type { TransitEntityRef } from '../../transit/entity-ref';

export type SchemaV16MigrationIssue =
  | { code: 'missing-legacy-line-membership'; serviceId: string }
  | { code: 'duplicate-legacy-line-membership'; serviceId: string; lineIds: string[] }
  | { code: 'invalid-legacy-line-membership'; lineId?: string; serviceId?: string }
  | { code: 'invalid-legacy-leg-extent'; serviceId: string; wayId: string }
  | { code: 'invalid-legacy-service-time'; serviceId: string }
  | { code: 'invalid-legacy-headway'; serviceId: string }
  | { code: 'missing-legacy-group-member'; groupId: string; memberId: string }
  | {
      code: 'ambiguous-legacy-group-member';
      groupId: string;
      memberId: string;
      entityKinds: TransitEntityRef['kind'][];
    };

export type SchemaV16MigrationResult =
  | { kind: 'migrated'; system: SchemaV17TransitSystem }
  | { kind: 'incompatible'; system: SchemaV16TransitSystem; issues: SchemaV16MigrationIssue[] };
