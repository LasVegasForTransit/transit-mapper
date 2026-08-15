import { describe, expect, it } from 'vitest';
import { serviceWorkerRegistrationEnabled } from '../src/registration-policy';

describe('service-worker registration policy', () => {
  it('registers only the editor surface', () => {
    expect(serviceWorkerRegistrationEnabled('/')).toBe(true);
    expect(serviceWorkerRegistrationEnabled('/systems')).toBe(true);
    expect(serviceWorkerRegistrationEnabled('/s/public-share')).toBe(false);
    expect(serviceWorkerRegistrationEnabled('/s')).toBe(false);
    expect(serviceWorkerRegistrationEnabled('/e/embedded-share')).toBe(false);
    expect(serviceWorkerRegistrationEnabled('/e')).toBe(false);
    expect(serviceWorkerRegistrationEnabled('/elevator')).toBe(true);
  });
});
