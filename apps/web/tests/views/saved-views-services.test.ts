// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { resourceFromShareUrl } from '../../src/views/saved-views-services';

describe('saved View browser services', () => {
  it('extracts the shared-system resource from the existing share route', () => {
    expect(resourceFromShareUrl('/s/share%2Fone')).toEqual({
      id: 'share/one',
      url: 'http://localhost:3000/s/share%2Fone',
    });
  });

  it('rejects a URL that is not a shared-system resource', () => {
    expect(() => resourceFromShareUrl('/v/view-1')).toThrow(
      'The system share returned an invalid link.',
    );
  });
});
