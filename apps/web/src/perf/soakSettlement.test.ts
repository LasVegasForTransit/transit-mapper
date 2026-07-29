import { describe, expect, it, vi } from 'vitest';
import { settleKeyboardPointerSentinels, type SoakPointerPage } from './soakSettlement';

describe('performance soak settlement', () => {
  it('consumes keyboard pointer sentinels without activating a primary map action', async () => {
    const click = vi.fn(async () => {});
    const page: SoakPointerPage = {
      mouse: { click },
      locator: () => ({
        first: () => ({
          boundingBox: async () => ({ x: 20, y: 40, width: 200, height: 100 }),
        }),
      }),
    };

    await settleKeyboardPointerSentinels(page);

    expect(click).toHaveBeenCalledWith(120, 90, { button: 'middle' });
  });
});
