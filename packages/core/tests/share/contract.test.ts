import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '../../src/model/serialize';
import {
  MAX_SHARE_BODY_BYTES,
  serializeShareRequest,
  shareRequestFits,
} from '../../src/share/contract';

describe('share request serialization', () => {
  it('serializes the system once into both the comparison data and request body', () => {
    const system = createEmptySystem();
    system.name = 'RTC "frequent" network';

    const request = serializeShareRequest(system);

    expect(request.data).toBe(JSON.stringify(system));
    expect(JSON.parse(request.body)).toEqual({ system });
    expect(request.byteLength).toBe(new TextEncoder().encode(request.body).byteLength);
  });

  it('counts UTF-8 bytes rather than JavaScript string code units', () => {
    const system = createEmptySystem();
    system.name = '🚍'.repeat(100);

    const request = serializeShareRequest(system);

    expect(request.byteLength).toBeGreaterThan(request.body.length);
  });

  it('includes preview bytes in the same body-size decision as the Worker', () => {
    const system = createEmptySystem();
    const withoutPreview = serializeShareRequest(system);
    const withPreview = serializeShareRequest(system, 'a'.repeat(1_000));

    expect(withPreview.byteLength).toBeGreaterThan(withoutPreview.byteLength);
    expect(shareRequestFits({ ...withoutPreview, byteLength: MAX_SHARE_BODY_BYTES })).toBe(true);
    expect(shareRequestFits({ ...withoutPreview, byteLength: MAX_SHARE_BODY_BYTES + 1 })).toBe(
      false,
    );
  });
});
