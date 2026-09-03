import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TRANSIT_API_RESOURCES,
  transitApiErrorStatus,
  type DescribeContentRequest,
  type EntityDetailPageRequest,
  type NetworkPageRequest,
  type SearchPageRequest,
  type TransitApiErrorCode,
  type TransitApiFailure,
  type TransitApiRequest,
  type TransitApiResourceMap,
  type TransitApiResponse,
  type TransitApiSuccess,
} from '../../../src/network/api-contract';
import type { ContentSearchResult } from '../../../src/network/content-search-provider';
import type { EntityDetailsResult } from '../../../src/network/entity-details-provider';
import type { ResolvedContentDescriptor } from '../../../src/network/resolved-content-reference';
import type { NetworkQueryResult } from '../../../src/network/result';

describe('transit API contract', () => {
  it('assigns the four resource requests to exact POST paths', () => {
    expect(TRANSIT_API_RESOURCES).toEqual({
      contentDescriptions: {
        method: 'POST',
        path: '/api/transit/content-descriptions',
      },
      networkPages: { method: 'POST', path: '/api/transit/network-pages' },
      searchPages: { method: 'POST', path: '/api/transit/search-pages' },
      entityDetailPages: {
        method: 'POST',
        path: '/api/transit/entity-detail-pages',
      },
    });
    expectTypeOf<
      (typeof TRANSIT_API_RESOURCES)[keyof typeof TRANSIT_API_RESOURCES]['path']
    >().toEqualTypeOf<
      | '/api/transit/content-descriptions'
      | '/api/transit/network-pages'
      | '/api/transit/search-pages'
      | '/api/transit/entity-detail-pages'
    >();
  });

  it('binds every request and response to transit-network-v1', () => {
    expectTypeOf<
      TransitApiRequest<DescribeContentRequest>['version']
    >().toEqualTypeOf<'transit-network-v1'>();
    expectTypeOf<
      TransitApiRequest<NetworkPageRequest>['value']
    >().toEqualTypeOf<NetworkPageRequest>();
    expectTypeOf<
      TransitApiRequest<SearchPageRequest>['value']
    >().toEqualTypeOf<SearchPageRequest>();
    expectTypeOf<
      TransitApiRequest<EntityDetailPageRequest>['value']
    >().toEqualTypeOf<EntityDetailPageRequest>();
    expectTypeOf<
      TransitApiResourceMap['/api/transit/content-descriptions']['result']
    >().toEqualTypeOf<ResolvedContentDescriptor>();
    expectTypeOf<
      TransitApiResourceMap['/api/transit/network-pages']['result']
    >().toEqualTypeOf<NetworkQueryResult>();
    expectTypeOf<
      TransitApiResourceMap['/api/transit/search-pages']['result']
    >().toEqualTypeOf<ContentSearchResult>();
    expectTypeOf<
      TransitApiResourceMap['/api/transit/entity-detail-pages']['result']
    >().toEqualTypeOf<EntityDetailsResult>();
    expectTypeOf<TransitApiErrorCode>().toEqualTypeOf<
      | 'invalid-request'
      | 'unsupported-version'
      | 'content-not-found'
      | 'revision-not-found'
      | 'content-unavailable'
      | 'invalid-cursor'
      | 'revision-conflict'
      | 'internal'
    >();

    const success: TransitApiSuccess<{ id: string }> = {
      version: 'transit-network-v1',
      result: { id: 'page-1' },
    };
    const failure: TransitApiFailure = {
      version: 'transit-network-v1',
      error: { code: 'invalid-cursor', message: 'The cursor does not match.', retryable: false },
    };
    const responses: TransitApiResponse<{ id: string }>[] = [success, failure];

    expect(responses.map((response) => ('result' in response ? 'success' : 'failure'))).toEqual([
      'success',
      'failure',
    ]);
  });

  it('maps documented failures without turning permanent errors into retryable outages', () => {
    expect(
      transitApiErrorStatus({ code: 'invalid-request', message: 'Invalid.', retryable: false }),
    ).toBe(400);
    expect(
      transitApiErrorStatus({
        code: 'unsupported-version',
        message: 'Unsupported.',
        retryable: false,
      }),
    ).toBe(400);
    expect(
      transitApiErrorStatus({ code: 'invalid-cursor', message: 'Invalid.', retryable: false }),
    ).toBe(400);
    expect(
      transitApiErrorStatus({ code: 'content-not-found', message: 'Missing.', retryable: false }),
    ).toBe(404);
    expect(
      transitApiErrorStatus({ code: 'revision-not-found', message: 'Missing.', retryable: false }),
    ).toBe(404);
    expect(
      transitApiErrorStatus({ code: 'revision-conflict', message: 'Conflict.', retryable: false }),
    ).toBe(409);
    expect(
      transitApiErrorStatus({ code: 'content-unavailable', message: 'Retry.', retryable: true }),
    ).toBe(503);
    expect(
      transitApiErrorStatus({
        code: 'content-unavailable',
        message: 'Unavailable.',
        retryable: false,
      }),
    ).toBe(500);
    expect(transitApiErrorStatus({ code: 'internal', message: 'Failed.', retryable: false })).toBe(
      500,
    );
  });
});
