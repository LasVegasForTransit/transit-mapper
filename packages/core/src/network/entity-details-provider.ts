import type { TransitEntityRef } from '../model/transit-entity-ref';
import type {
  BoardingRule,
  InstantRange,
  OperationalScope,
  ServiceDateRange,
  ServiceTimeZone,
} from '../transit/value-types';
import type { ResolveOptions } from './content-provider';
import type { ViewQuery } from './query';
import type { ResolvedContentRef } from './resolved-content-reference';
import type {
  ResolvedAdvisory,
  ResolvedOperationalChange,
  ResolvedReplacementLink,
  ResolvedSourceEvidence,
} from './resolved-network-chunk';

export interface EntityDetailsQuery {
  entity: TransitEntityRef;
  serviceTime: ViewQuery['serviceTime'];
  window?: InstantRange;
  limit: number;
  cursor?: string;
}

export interface CalendarSummary {
  id: string;
  timeZone: ServiceTimeZone;
  dateRange: ServiceDateRange;
}

export interface TripSummary {
  id: string;
  patternId: string;
  calendarId: string;
  serviceDate: string;
  startTimeSeconds?: number;
}

export interface FrequencySummary {
  id: string;
  patternId: string;
  calendarId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  headwaySeconds: number;
  precision: 'exact' | 'headway' | 'unknown';
}

export interface StopCallSummary {
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

export interface ResolvedServicePlanStatus {
  lineId: string;
  servicePlanId: string;
  activity: 'active' | 'inactive' | 'unknown';
  scope?: OperationalScope;
  replacements: readonly ResolvedReplacementLink[];
  source?: ResolvedSourceEvidence;
}

export type EntityDetailItem =
  | { kind: 'calendar'; value: CalendarSummary }
  | { kind: 'trip'; value: TripSummary }
  | { kind: 'frequency'; value: FrequencySummary }
  | { kind: 'stop-call'; value: StopCallSummary }
  | { kind: 'service-plan-status'; value: ResolvedServicePlanStatus }
  | { kind: 'operational-change'; value: ResolvedOperationalChange }
  | { kind: 'advisory'; value: ResolvedAdvisory };

export interface EntityDetailsResult {
  entity: TransitEntityRef;
  label: string;
  items: readonly EntityDetailItem[];
  nextCursor?: string;
}

export interface EntityDetailsProvider {
  details(
    content: ResolvedContentRef,
    query: EntityDetailsQuery,
    options?: ResolveOptions,
  ): Promise<EntityDetailsResult>;
}
