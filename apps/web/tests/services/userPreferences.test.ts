import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUnitPreference, unitSystemForLocale } from '../../src/services/userPreferences';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the default unit preference', () => {
  it.each(['en-US', 'en-US-u-hc-h12', 'en-LR', 'my', 'my-MM'])(
    'defaults %s to imperial units',
    (locale) => {
      expect(unitSystemForLocale(locale)).toBe('imperial');
    },
  );

  it.each(['en-GB', 'fr-FR', 'de-DE'])('defaults %s to metric units', (locale) => {
    expect(unitSystemForLocale(locale)).toBe('metric');
  });

  it('does not crash when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    expect(() => setUnitPreference('imperial')).not.toThrow();
  });
});
