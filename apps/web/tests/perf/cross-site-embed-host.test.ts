import { describe, expect, it } from 'vitest';
import {
  crossSiteEmbedHostHtml,
  crossSiteEmbedHostUrl,
} from '../../scripts/perf/playwright-first-session';

describe('the cross-site embed host', () => {
  it('uses a visible native lazy iframe without host-page network dependencies', () => {
    const html = crossSiteEmbedHostHtml('https://app.test/e/perfembed');

    expect(html).toContain('loading="lazy"');
    expect(html).toContain('src="https://app.test/e/perfembed"');
    expect(html).toContain('title="TransitMapper performance embed"');
    expect(html).toContain('<link rel="icon" href="data:,">');
    expect(html).not.toContain('<script');
  });

  it('escapes the iframe source as an HTML attribute', () => {
    const html = crossSiteEmbedHostHtml('https://app.test/e/perfembed?x="&y=<');

    expect(html).toContain('src="https://app.test/e/perfembed?x=&quot;&amp;y=&lt;"');
  });

  it('navigates a distinct origin so the host document has a measured response', () => {
    const host = crossSiteEmbedHostUrl('https://app.test/e/perfembed');

    expect(new URL(host).origin).not.toBe('https://app.test');
    expect(host).toBe('https://transitmapper-perf-host.invalid/first-session');
  });
});
