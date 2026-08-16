import { describe, expect, it, vi } from 'vitest';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createQuickExportController } from '../../src/share/quick-export';

const system = { id: 'system' } as TransitSystem;
const view = {
  viewMode: 'network' as const,
  visibleModes: new Set<string>(),
  visibleWayTypes: new Set<string>(),
};

describe('quick export loading', () => {
  it('preloads one shared export runtime and dispatches the selected format', async () => {
    const png = vi.fn();
    const svg = vi.fn();
    const loadPng = vi.fn(() => Promise.resolve({ exportFullSystemPng: png }));
    const loadSvg = vi.fn(() => Promise.resolve({ exportFullSystemSvg: svg }));
    const quickExport = createQuickExportController({ loadPng, loadSvg });

    quickExport.preload();
    quickExport.preload();
    await Promise.resolve();

    expect(loadPng).toHaveBeenCalledOnce();
    expect(loadSvg).toHaveBeenCalledOnce();

    await quickExport.export('png', system, view, 'system.png');
    await quickExport.export('svg', system, view, 'system.svg');

    expect(png).toHaveBeenCalledWith(system, view, 'system.png');
    expect(svg).toHaveBeenCalledWith(system, view, 'system.svg');
  });
});
