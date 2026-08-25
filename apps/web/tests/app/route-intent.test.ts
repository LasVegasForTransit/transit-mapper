import { describe, expect, it } from 'vitest';
import { parseRouteIntent } from '../../src/app/route-intent';

describe('application route intent', () => {
  it.each([
    ['/s/a', 'a'],
    ['/s/abc123', 'abc123'],
    [`/s/${'a'.repeat(32)}`, 'a'.repeat(32)],
    ['/s/abc123/', 'abc123'],
  ])('recognizes the deployed shared-system path %s', (pathname, shareId) => {
    expect(parseRouteIntent(pathname)).toEqual({ kind: 'shared-system', shareId });
  });

  it.each([
    '/',
    '/editor',
    '/s/',
    '/s/ABC123',
    '/s/abc-123',
    `/s/${'a'.repeat(33)}`,
    '/s/abc123/details',
    '/s/abc123//',
  ])('keeps %s on the editor fallback', (pathname) => {
    expect(parseRouteIntent(pathname)).toEqual({ kind: 'editor' });
  });
});
