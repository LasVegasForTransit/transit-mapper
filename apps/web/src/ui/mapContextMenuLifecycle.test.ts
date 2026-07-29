import { describe, expect, it } from 'vitest';
import { shouldCloseMapContextMenu } from './mapContextMenuLifecycle';

const openMenu = {
  actionCount: 1,
  openedTool: 'select' as const,
  currentTool: 'select' as const,
  openedViewMode: 'network' as const,
  currentViewMode: 'network' as const,
};

describe('map context-menu lifecycle', () => {
  it('closes an actionless menu, including a menu made empty by read-only state', () => {
    expect(shouldCloseMapContextMenu({ ...openMenu, actionCount: 0 })).toBe(true);
  });

  it('closes when the active tool changes', () => {
    expect(shouldCloseMapContextMenu({ ...openMenu, currentTool: 'way' })).toBe(true);
  });

  it('closes when the map projection changes', () => {
    expect(shouldCloseMapContextMenu({ ...openMenu, currentViewMode: 'diagram' })).toBe(true);
  });

  it('keeps a menu open only while its original interaction remains valid', () => {
    expect(shouldCloseMapContextMenu(openMenu)).toBe(false);
  });
});
