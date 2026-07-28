import type { TransitSystem } from '@transitmapper/core/model/system';
import type { Viewport } from '@transitmapper/core/render/project';
import type { SvgRenderOptions } from '@transitmapper/core/render/svg';
import type { ViewOptions } from '../map/layers';

export interface SvgWorkerRequest {
  system: TransitSystem;
  view: ViewOptions;
  viewport: Viewport;
  options: SvgRenderOptions;
}

export type SvgWorkerEvent = { kind: 'done'; markup: string } | { kind: 'error'; message: string };
