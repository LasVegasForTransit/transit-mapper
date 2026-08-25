import { describe, expect, it, vi } from 'vitest';
import { claimEditorMapNavigation } from '../../src/map/editor-map-navigation';

function handler(enabled: boolean) {
  let active = enabled;
  return {
    disable: vi.fn(() => {
      active = false;
    }),
    enable: vi.fn(() => {
      active = true;
    }),
    isEnabled: () => active,
  };
}

describe('editor map navigation ownership', () => {
  it('claims enabled native gestures and restores their prior state on disposal', () => {
    const dragPan = handler(true);
    const dragRotate = handler(false);
    const doubleClickZoom = handler(true);
    const keyboard = handler(true);
    const boxZoom = handler(true);
    const release = claimEditorMapNavigation({
      dragPan,
      dragRotate,
      doubleClickZoom,
      keyboard,
      boxZoom,
    });

    expect(dragPan.isEnabled()).toBe(false);
    expect(dragRotate.isEnabled()).toBe(false);
    expect(doubleClickZoom.isEnabled()).toBe(false);
    expect(keyboard.isEnabled()).toBe(false);
    expect(boxZoom.isEnabled()).toBe(false);

    release();
    release();

    expect(dragPan.isEnabled()).toBe(true);
    expect(dragRotate.isEnabled()).toBe(false);
    expect(doubleClickZoom.isEnabled()).toBe(true);
    expect(keyboard.isEnabled()).toBe(true);
    expect(boxZoom.isEnabled()).toBe(true);
    expect(dragPan.enable).toHaveBeenCalledOnce();
    expect(dragRotate.enable).not.toHaveBeenCalled();
  });
});
