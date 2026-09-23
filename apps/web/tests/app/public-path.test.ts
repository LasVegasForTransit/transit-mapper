import { describe, expect, it } from 'vitest';
import { appRoutePath, publicBasePath, publicPath, publicUrl } from '../../src/app/public-path';

const labsLocation = {
  hostname: 'labs.lasvegasfortransit.org',
  pathname: '/transit-mapper/s/example',
  origin: 'https://labs.lasvegasfortransit.org',
};

describe('public Labs paths', () => {
  it('mounts public requests below the Labs project path', () => {
    expect(publicBasePath(labsLocation)).toBe('/transit-mapper');
    expect(publicPath('/api/systems', labsLocation)).toBe('/transit-mapper/api/systems');
    expect(publicUrl('/s/example', labsLocation)).toBe(
      'https://labs.lasvegasfortransit.org/transit-mapper/s/example',
    );
  });

  it('normalizes a Labs browser route before application routing', () => {
    expect(appRoutePath('/transit-mapper/s/example', labsLocation)).toBe('/s/example');
    expect(appRoutePath('/transit-mapper', { ...labsLocation, pathname: '/transit-mapper' })).toBe(
      '/',
    );
  });

  it('keeps the canonical map hostname rooted', () => {
    const canonical = {
      hostname: 'map.lasvegasfortransit.org',
      pathname: '/s/example',
      origin: 'https://map.lasvegasfortransit.org',
    };
    expect(publicBasePath(canonical)).toBe('');
    expect(publicPath('/api/systems', canonical)).toBe('/api/systems');
  });
});
