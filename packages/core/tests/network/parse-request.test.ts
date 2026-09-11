import { describe, expect, it } from 'vitest';
import {
  parseContentRef,
  parseGeographicBounds,
  parseNetworkQuery,
  parseResolvedContentRef,
} from '../../src/network/parse-request';

const validQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -115.3, south: 36.0, east: -115.0, north: 36.3 },
  detailBand: 'district',
};

describe('parsing a content reference', () => {
  it('accepts the two revisions a System can be asked for', () => {
    expect(
      parseContentRef({ kind: 'transit-system', id: 'sys', revision: { kind: 'latest' } }),
    ).toEqual({ kind: 'transit-system', id: 'sys', revision: { kind: 'latest' } });

    expect(
      parseContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'pinned', systemRevisionId: 'rev-1' },
      }),
    ).toEqual({
      kind: 'transit-system',
      id: 'sys',
      revision: { kind: 'pinned', systemRevisionId: 'rev-1' },
    });
  });

  it('refuses a latest reference that also names a revision', () => {
    expect(() =>
      parseContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'latest', systemRevisionId: 'rev-1' },
      }),
    ).toThrow(/must not name a revision/);
  });

  it('refuses an unknown revision kind rather than defaulting to one', () => {
    expect(() =>
      parseContentRef({ kind: 'transit-system', id: 'sys', revision: { kind: 'sideways' } }),
    ).toThrow(/revision\.kind must be latest or pinned/);
  });

  it('says a Dataset is unserved rather than reporting a malformed request', () => {
    expect(() =>
      parseContentRef({
        kind: 'transit-dataset',
        id: 'ds',
        revision: { kind: 'latest', operational: { kind: 'planned' } },
      }),
    ).toThrow(/Dataset content is not served yet/);
  });

  it('refuses a field this version does not understand', () => {
    expect(() =>
      parseContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'latest' },
        operational: { kind: 'planned' },
      }),
    ).toThrow(/unknown field operational/);
  });

  it('refuses a blank System ID', () => {
    expect(() =>
      parseContentRef({ kind: 'transit-system', id: '   ', revision: { kind: 'latest' } }),
    ).toThrow(/must not be blank/);
  });
});

describe('parsing a resolved content reference', () => {
  it('accepts a working revision carrying a lowercase SHA-256 digest', () => {
    const digest = { algorithm: 'sha-256', value: 'a'.repeat(64) };
    expect(
      parseResolvedContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'working', contentDigest: digest },
      }),
    ).toEqual({
      kind: 'transit-system',
      id: 'sys',
      revision: { kind: 'working', contentDigest: digest },
    });
  });

  it('accepts a published revision named by its stored identity', () => {
    expect(
      parseResolvedContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'published', systemRevisionId: 'rev-1' },
      }),
    ).toEqual({
      kind: 'transit-system',
      id: 'sys',
      revision: { kind: 'published', systemRevisionId: 'rev-1' },
    });
  });

  it('refuses a digest that is not a lowercase SHA-256 value', () => {
    expect(() =>
      parseResolvedContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: {
          kind: 'working',
          contentDigest: { algorithm: 'sha-256', value: 'A'.repeat(64) },
        },
      }),
    ).toThrow(/lowercase SHA-256 digest/);
  });

  it('refuses a digest algorithm the identity rules do not use', () => {
    expect(() =>
      parseResolvedContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'working', contentDigest: { algorithm: 'md5', value: 'a'.repeat(64) } },
      }),
    ).toThrow(/algorithm must be sha-256/);
  });

  it('refuses a revision kind that belongs to the unresolved reference', () => {
    expect(() =>
      parseResolvedContentRef({
        kind: 'transit-system',
        id: 'sys',
        revision: { kind: 'latest' },
      }),
    ).toThrow(/must be working or published/);
  });
});

describe('parsing geographic bounds', () => {
  it('reads an ordinary box', () => {
    expect(parseGeographicBounds(validQuery.bounds, 'bounds')).toEqual(validQuery.bounds);
  });

  it('reads a box that crosses the antimeridian', () => {
    const crossing = {
      kind: 'crosses-antimeridian',
      west: 170,
      south: -10,
      east: -170,
      north: 10,
    };
    expect(parseGeographicBounds(crossing, 'bounds')).toEqual(crossing);
  });

  it('refuses an ordinary box written east-of-west, which is the crossing case undeclared', () => {
    expect(() =>
      parseGeographicBounds(
        { kind: 'ordinary', west: 170, south: -10, east: -170, north: 10 },
        'bounds',
      ),
    ).toThrow(/must not be east of/);
  });

  it('refuses a crossing box that does not cross', () => {
    expect(() =>
      parseGeographicBounds(
        { kind: 'crosses-antimeridian', west: -115.3, south: 36, east: -115, north: 36.3 },
        'bounds',
      ),
    ).toThrow(/does not cross the antimeridian/);
  });

  it('refuses an inverted box and out-of-range degrees', () => {
    expect(() =>
      parseGeographicBounds(
        { kind: 'ordinary', west: -115.3, south: 36.3, east: -115, north: 36 },
        'bounds',
      ),
    ).toThrow(/must not be north of/);
    expect(() =>
      parseGeographicBounds(
        { kind: 'ordinary', west: -115.3, south: 36, east: -115, north: 91 },
        'bounds',
      ),
    ).toThrow(/within -90 and 90/);
  });
});

describe('parsing a network query', () => {
  it('reads a complete query and leaves the cursor absent', () => {
    const query = parseNetworkQuery(validQuery);
    expect(query).toEqual(validQuery);
    expect('cursor' in query).toBe(false);
  });

  it('carries a cursor when one is supplied', () => {
    expect(parseNetworkQuery({ ...validQuery, cursor: 'page-2' }).cursor).toBe('page-2');
  });

  it('reads a mode selection that names ids', () => {
    const query = parseNetworkQuery({
      ...validQuery,
      modes: { kind: 'only', ids: ['bus', 'tram'] },
    });
    expect(query.modes).toEqual({ kind: 'only', ids: ['bus', 'tram'] });
  });

  it('refuses a mode selection that both selects everything and names ids', () => {
    expect(() =>
      parseNetworkQuery({ ...validQuery, modes: { kind: 'all', ids: ['bus'] } }),
    ).toThrow(/must not list ids/);
  });

  it('refuses a service time that is both live and an instant', () => {
    expect(() =>
      parseNetworkQuery({
        ...validQuery,
        serviceTime: { kind: 'live', value: '2026-09-11T12:00:00.000Z' },
      }),
    ).toThrow(/must not carry an instant/);
  });

  it('reads an instant service time', () => {
    const query = parseNetworkQuery({
      ...validQuery,
      serviceTime: { kind: 'instant', value: '2026-09-11T12:00:00.000Z' },
    });
    expect(query.serviceTime).toEqual({
      kind: 'instant',
      value: '2026-09-11T12:00:00.000Z',
    });
  });

  it('refuses a detail band outside the three the renderer knows', () => {
    expect(() => parseNetworkQuery({ ...validQuery, detailBand: 'city' })).toThrow(
      /overview, district, street/,
    );
  });

  it('reads boolean, single and multiple filter values', () => {
    const query = parseNetworkQuery({
      ...validQuery,
      filters: { landmarks: true, representation: 'network', modes: ['bus'] },
    });
    expect(query.filters).toEqual({
      landmarks: true,
      representation: 'network',
      modes: ['bus'],
    });
  });

  it('names the field that was wrong rather than failing generically', () => {
    expect(() => parseNetworkQuery({ ...validQuery, bounds: { kind: 'ordinary' } })).toThrow(
      /query\.bounds is missing field west/,
    );
  });
});
