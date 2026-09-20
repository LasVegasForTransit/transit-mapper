// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://map.lasvegasfortransit.org/" }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { csp, shouldEnable } from '@lasvegasfortransit/analytics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTransitMapperAnalytics, transitMapperAnalyticsOptions } from '../../src/analytics';

const TOKEN = 'a'.repeat(32);
const WEB_ROOT = resolve(import.meta.dirname, '../..');

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TransitMapper analytics', () => {
  it('filters excluded pageviews while preserving allowed SPA pageviews', () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => undefined);
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined);
    const analytics = startTransitMapperAnalytics(TOKEN);
    const script = document.querySelector<HTMLScriptElement>('[data-lvbt-analytics]');

    expect(analytics).toMatchObject({ enabled: true });
    expect(JSON.parse(script?.dataset.cfBeacon ?? '{}')).toEqual({ token: TOKEN, spa: true });

    open.mockClear();
    send.mockClear();
    const sendPageview = (pathname: string): string => {
      const body = JSON.stringify({ location: `https://map.lasvegasfortransit.org${pathname}` });
      const request = new XMLHttpRequest();
      request.open('POST', 'https://cloudflareinsights.com/cdn-cgi/rum');
      request.send(body);
      return body;
    };

    sendPageview('/s/example');
    sendPageview('/e/example');
    const allowed = sendPageview('/editor');

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(allowed);
  });

  it('suppresses share pageviews without fully excluding the route', () => {
    const options = transitMapperAnalyticsOptions(TOKEN);

    expect(options.noPageviews?.some((pattern) => pattern.test('/s/example'))).toBe(true);
    expect(
      shouldEnable({ ...options, hostname: 'map.lasvegasfortransit.org', pathname: '/s/example' }),
    ).toEqual({ enabled: true });
  });

  it('fully excludes embed routes', () => {
    const analytics = shouldEnable({
      ...transitMapperAnalyticsOptions(TOKEN),
      hostname: 'map.lasvegasfortransit.org',
      pathname: '/e/example',
    });

    expect(analytics).toMatchObject({ enabled: false, reason: 'excluded-path' });
  });

  it('stays absent when local, preview, or archive builds omit the token', () => {
    const analytics = shouldEnable({
      ...transitMapperAnalyticsOptions(''),
      hostname: 'map.lasvegasfortransit.org',
      pathname: '/',
    });

    expect(analytics).toMatchObject({ enabled: false, reason: 'no-token' });
  });

  it('keeps the static asset policy compatible with the analytics endpoints', () => {
    const headers = readFileSync(resolve(WEB_ROOT, 'public/_headers'), 'utf8');

    expect(csp.check(headers)).toEqual([]);
  });
});
