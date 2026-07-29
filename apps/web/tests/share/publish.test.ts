import { describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { MAX_SHARE_BODY_BYTES } from '@transitmapper/core/share/contract';
import { prepareSharePayload, ShareTooLargeError } from '../../src/share/publish';

describe('share publishing preparation', () => {
  it('rejects an oversized system before rendering its preview', async () => {
    const system = createEmptySystem();
    system.name = 'x'.repeat(MAX_SHARE_BODY_BYTES);
    const renderPreview = vi.fn(async () => 'preview');

    await expect(prepareSharePayload(system, { renderPreview })).rejects.toBeInstanceOf(
      ShareTooLargeError,
    );
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it('omits a best-effort preview when it alone would cross the request limit', async () => {
    const system = createEmptySystem();
    const renderPreview = vi.fn(async () => 'a'.repeat(MAX_SHARE_BODY_BYTES));

    const request = await prepareSharePayload(system, { renderPreview });

    expect(JSON.parse(request.body)).toEqual({ system });
    expect(request.byteLength).toBeLessThanOrEqual(MAX_SHARE_BODY_BYTES);
  });

  it('keeps a preview that fits and reuses the original system serialization', async () => {
    const system = createEmptySystem();

    const request = await prepareSharePayload(system, {
      renderPreview: async () => 'small-preview',
    });

    expect(request.data).toBe(JSON.stringify(system));
    expect(JSON.parse(request.body)).toEqual({ system, preview: 'small-preview' });
  });

  it('stops between serialization and preview work when publishing is canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    const renderPreview = vi.fn(async () => 'preview');

    await expect(
      prepareSharePayload(createEmptySystem(), {
        renderPreview,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderPreview).not.toHaveBeenCalled();
  });
});
