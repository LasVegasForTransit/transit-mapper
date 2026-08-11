import type { TransitSystem, Viewport } from '@transitmapper/core/model/system';
import type { RendererCaptureViewMode } from './renderer-capture';

export type RendererFixtureId =
  | 'port-mason'
  | 'dense-downtown'
  | 'rtc-scale'
  | 'acute-junction'
  | 'five-arm-junction'
  | 'grade-stack'
  | 'noisy-curves'
  | 'rail-guideway'
  | 'shared-service-trunk'
  | 'complex-diagram';

export interface RendererFixtureDescriptor {
  id: RendererFixtureId;
  label: string;
  camera: Viewport;
  viewMode: RendererCaptureViewMode;
  create: () => TransitSystem;
}
