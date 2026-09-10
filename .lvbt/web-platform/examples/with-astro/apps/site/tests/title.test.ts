import { describe, expect, it } from 'vitest';

import { pageTitle, siteName } from '../src/lib/title';

describe('pageTitle', () => {
  it('is the site name on the home page', () => {
    expect(pageTitle()).toBe(siteName);
  });

  it('puts the page before the site name elsewhere', () => {
    expect(pageTitle('About')).toBe('About · LVBT site');
  });
});
