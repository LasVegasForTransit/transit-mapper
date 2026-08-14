import type { TransitSystem } from '@transitmapper/core/model/system';
import type { Viewport } from '@transitmapper/core/render/project';
import type { SvgRenderOptions } from '@transitmapper/core/render/svg';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { GroundPlaneProjection } from './svg-worker-projector';

interface SvgWorkerRequestBase {
  system: TransitSystem;
  view: RenderViewOptions;
  options: SvgRenderOptions;
}

/** Quick export owns a pure north-up viewport; framed-map export sends four
 * live camera samples so bearing and pitch remain exact without retaining a
 * second copy of the static renderer on the main thread. */
export type SvgWorkerRequest = SvgWorkerRequestBase &
  (
    | { viewport: Viewport; projection?: never }
    | { projection: GroundPlaneProjection; viewport?: never }
  );

export type SvgWorkerEvent = { kind: 'done'; markup: string } | { kind: 'error'; message: string };
