import type { TransitSystem } from '@transitmapper/core/model/system';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';

export type QuickExportFormat = 'png' | 'svg';

interface PngExportModule {
  exportFullSystemPng(system: TransitSystem, view: ViewOptions, filename?: string): void;
}

interface SvgExportModule {
  exportFullSystemSvg(system: TransitSystem, view: ViewOptions, filename?: string): void;
}

export interface QuickExportControllerOptions {
  loadPng(): Promise<PngExportModule>;
  loadSvg(): Promise<SvgExportModule>;
}

export interface QuickExportController {
  preload(): void;
  export(
    format: QuickExportFormat,
    system: TransitSystem,
    view: ViewOptions,
    filename: string,
  ): Promise<void>;
}

/**
 * The offscreen PNG renderer brings MapLibre into memory, so only an explicit
 * export intent can load it. One shared promise makes pointer-down/focus
 * preload and the eventual click converge instead of opening parallel WebGL
 * setup paths.
 */
export function createQuickExportController(
  options: QuickExportControllerOptions,
): QuickExportController {
  let modules: Promise<readonly [PngExportModule, SvgExportModule]> | undefined;
  const load = () =>
    (modules ??= Promise.all([options.loadPng(), options.loadSvg()]) as Promise<
      readonly [PngExportModule, SvgExportModule]
    >);

  return {
    preload() {
      void load();
    },
    async export(format, system, view, filename) {
      const [png, svg] = await load();
      if (format === 'png') png.exportFullSystemPng(system, view, filename);
      else svg.exportFullSystemSvg(system, view, filename);
    },
  };
}

const quickExport = createQuickExportController({
  loadPng: () => import('./pngExport'),
  loadSvg: () => import('./svgExport'),
});

export function preloadQuickExport(): void {
  quickExport.preload();
}

export function exportQuickSystem(
  format: QuickExportFormat,
  system: TransitSystem,
  view: ViewOptions,
  filename: string,
): Promise<void> {
  return quickExport.export(format, system, view, filename).catch((error: unknown) => {
    console.error('Quick export could not start', error);
  });
}

/** Keyboard capture has no ViewProvider, so it intentionally exports the
 * complete network with every catalog layer visible. */
export function exportNetworkPng(system: TransitSystem): Promise<void> {
  return exportQuickSystem(
    'png',
    system,
    {
      viewMode: 'network',
      visibleModes: new Set(MODE_ORDER),
      visibleWayTypes: new Set(WAY_TYPE_ORDER),
    },
    `${system.name || 'transit-system'}.png`,
  );
}
