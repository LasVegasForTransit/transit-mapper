import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createEncodedJsonResponses,
  selectEncodedJsonResponse,
} from '../../../scripts/perf/compressedJsonResponse';

describe('compressed performance responses', () => {
  const json = JSON.stringify({
    id: 'published',
    system: { ways: Array.from({ length: 200 }, (_, index) => ({ id: `way-${index}` })) },
  });

  it('serves gzip only when the client accepts it and preserves the exact JSON', () => {
    const responses = createEncodedJsonResponses(json);
    const selected = selectEncodedJsonResponse(responses, 'br, gzip, deflate');

    expect(selected.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(selected.body).toString('utf8')).toBe(json);
    expect(selected.body.byteLength).toBeLessThan(responses.identity.byteLength);
  });

  it('serves identity when gzip is absent or explicitly refused', () => {
    const responses = createEncodedJsonResponses(json);

    for (const acceptEncoding of [null, 'br', 'gzip;q=0, *;q=0.5']) {
      const selected = selectEncodedJsonResponse(responses, acceptEncoding);

      expect(selected.headers['content-encoding']).toBeUndefined();
      expect(selected.body.toString('utf8')).toBe(json);
    }
  });
});
