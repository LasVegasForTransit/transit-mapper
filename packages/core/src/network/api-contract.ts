import type { ContentRef } from './content-reference';
import type { ContentSearchQuery, ContentSearchResult } from './content-search-provider';
import type { EntityDetailsQuery, EntityDetailsResult } from './entity-details-provider';
import type { NetworkQuery } from './query';
import type { ResolvedContentDescriptor, ResolvedContentRef } from './resolved-content-reference';
import type { NetworkQueryResult } from './result';

export const TRANSIT_API_RESOURCES = {
  contentDescriptions: {
    method: 'POST',
    path: '/api/transit/content-descriptions',
  },
  networkPages: {
    method: 'POST',
    path: '/api/transit/network-pages',
  },
  searchPages: {
    method: 'POST',
    path: '/api/transit/search-pages',
  },
  entityDetailPages: {
    method: 'POST',
    path: '/api/transit/entity-detail-pages',
  },
} as const satisfies Record<string, { method: 'POST'; path: keyof TransitApiResourceMap }>;

export type TransitApiVersion = 'transit-network-v1';

export interface TransitApiRequest<Value> {
  version: TransitApiVersion;
  value: Value;
}

export interface TransitApiSuccess<Value> {
  version: TransitApiVersion;
  result: Value;
}

export type TransitApiErrorCode =
  | 'invalid-request'
  | 'unsupported-version'
  | 'content-not-found'
  | 'revision-not-found'
  | 'content-unavailable'
  | 'invalid-cursor'
  | 'revision-conflict'
  | 'internal';

export interface TransitApiError {
  code: TransitApiErrorCode;
  message: string;
  retryable: boolean;
}

export interface TransitApiFailure {
  version: TransitApiVersion;
  error: TransitApiError;
}

export type TransitApiResponse<Value> = TransitApiSuccess<Value> | TransitApiFailure;

export interface DescribeContentRequest {
  reference: ContentRef;
}

export interface NetworkPageRequest {
  content: ResolvedContentRef;
  query: NetworkQuery;
}

export interface SearchPageRequest {
  content: ResolvedContentRef;
  query: ContentSearchQuery;
}

export interface EntityDetailPageRequest {
  content: ResolvedContentRef;
  query: EntityDetailsQuery;
}

export interface TransitApiResourceMap {
  '/api/transit/content-descriptions': {
    request: DescribeContentRequest;
    result: ResolvedContentDescriptor;
  };
  '/api/transit/network-pages': {
    request: NetworkPageRequest;
    result: NetworkQueryResult;
  };
  '/api/transit/search-pages': {
    request: SearchPageRequest;
    result: ContentSearchResult;
  };
  '/api/transit/entity-detail-pages': {
    request: EntityDetailPageRequest;
    result: EntityDetailsResult;
  };
}

export type TransitApiFailureStatus = 400 | 404 | 409 | 500 | 503;

export function transitApiErrorStatus(error: TransitApiError): TransitApiFailureStatus {
  switch (error.code) {
    case 'invalid-request':
    case 'unsupported-version':
    case 'invalid-cursor':
      return 400;
    case 'content-not-found':
    case 'revision-not-found':
      return 404;
    case 'revision-conflict':
      return 409;
    case 'content-unavailable':
      return error.retryable ? 503 : 500;
    case 'internal':
      return 500;
  }
}
