import type { Attribution, ContentDigest, LicenseRef } from '../source/value-types';

export type ResolvedContentRef =
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

export interface FilterOption {
  value: string;
  label: string;
}

export type ViewFilterDefinition =
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

export interface ContentMapDefinition {
  defaultRepresentationId: string;
  representationIds: readonly [string, ...string[]];
  modeIds: readonly string[];
  defaultModeIds: readonly string[];
  filters: readonly ViewFilterDefinition[];
}

export interface ResolvedContentDescriptor {
  content: ResolvedContentRef;
  map: ContentMapDefinition;
  attributions: readonly Attribution[];
  licenses: readonly LicenseRef[];
  sources: readonly ResolvedSourceStatus[];
}

export interface ResolvedSourceStatus {
  sourceId: string;
  name: string;
  attribution: Attribution;
  lastUpdatedAt?: string;
  freshness: 'fresh' | 'stale' | 'not-applicable' | 'unknown';
}
