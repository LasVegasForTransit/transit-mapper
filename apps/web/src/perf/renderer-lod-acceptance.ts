import { defaultProfileFor, profileWidthM } from '@transitmapper/core/model/profile';
import { widthPxAtZ14 } from '@transitmapper/core/render/constants';
import type { PerfProfileId } from './types';
import { PORT_MASON_RENDERER_CENTER } from './renderer-port-mason-fixture';
import { rendererCaptureZoomForCorridorWidth } from './renderer-capture';

export const RENDERER_LOD_ACCEPTANCE_SUITE_ID = 'phase-2-lod' as const;
export const RENDERER_LOD_ACCEPTANCE_PHASE = '01-lod' as const;

export const RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS = [
  'hover-zero-committed-work',
  'selection-zero-committed-work',
  'filter-zero-committed-work',
  'retained-theme-zero-committed-work',
  'accepted-camera-reuses-scene',
  'invalidating-camera-reprojects',
] as const;

export const RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS = [
  ...RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS,
  'bank-promotion-is-atomic',
] as const;

export type RendererLodAcceptanceAssertionId =
  (typeof RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS)[number];
export type RendererLodAcceptanceSurface = 'live-maplibre' | 'static-maplibre' | 'svg';
export type RendererLodAcceptanceFixtureId =
  'port-mason' | 'grade-stack' | 'served-three-arm' | 'served-four-arm' | 'served-five-arm';

export interface RendererLodAcceptanceViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface RendererLodAcceptanceCamera {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly viewport: RendererLodAcceptanceViewport;
  readonly targetCorridorWidthPx?: number;
}

export interface RendererLodAcceptanceVisualCase {
  readonly id: string;
  readonly file: `images/${string}.png`;
  readonly fixtureId: RendererLodAcceptanceFixtureId;
  readonly surface: RendererLodAcceptanceSurface;
  readonly camera: RendererLodAcceptanceCamera;
  readonly state: 'selected' | 'settled' | 'moving' | 'bank-old' | 'bank-preparing' | 'bank-new';
}

const ACCEPTANCE_VIEWPORT: RendererLodAcceptanceViewport = {
  width: 960,
  height: 600,
  pixelRatio: 1,
};
const GRADE_STACK_CENTER = [-115.176, 36.13] as const;
const ROAD_WIDTH_AT_GRADE_STACK_Z14 = widthPxAtZ14(
  profileWidthM(defaultProfileFor('road')),
  GRADE_STACK_CENTER[1],
);

function gradeStackZoomForCorridorWidth(targetCorridorWidthPx: number): number {
  return 14 + Math.log2(targetCorridorWidthPx / ROAD_WIDTH_AT_GRADE_STACK_Z14);
}

function camera(
  center: readonly [number, number],
  zoom: number,
  targetCorridorWidthPx?: number,
): RendererLodAcceptanceCamera {
  return {
    center,
    zoom,
    viewport: ACCEPTANCE_VIEWPORT,
    ...(targetCorridorWidthPx === undefined ? {} : { targetCorridorWidthPx }),
  };
}

function visual(
  id: string,
  fixtureId: RendererLodAcceptanceFixtureId,
  surface: RendererLodAcceptanceSurface,
  visualCamera: RendererLodAcceptanceCamera,
  state: RendererLodAcceptanceVisualCase['state'] = 'settled',
): RendererLodAcceptanceVisualCase {
  return { id, file: `images/${id}.png`, fixtureId, surface, camera: visualCamera, state };
}

const SELECTED_CAMERA = camera(
  PORT_MASON_RENDERER_CENTER,
  rendererCaptureZoomForCorridorWidth(10.5),
  10.5,
);
const TUNNEL_BELOW_CAMERA = camera(GRADE_STACK_CENTER, gradeStackZoomForCorridorWidth(11.9), 11.9);
const TUNNEL_AT_CAMERA = camera(GRADE_STACK_CENTER, gradeStackZoomForCorridorWidth(12), 12);
const JUNCTION_CAMERA = camera(GRADE_STACK_CENTER, 17.5);
const PAN_CAMERA = camera(PORT_MASON_RENDERER_CENTER, rendererCaptureZoomForCorridorWidth(6), 6);
const PAN_EDGE_CAMERA = camera([-122.434, PORT_MASON_RENDERER_CENTER[1]], PAN_CAMERA.zoom, 6);
const PAN_SETTLED_CAMERA = camera([-122.422, PORT_MASON_RENDERER_CENTER[1]], PAN_CAMERA.zoom, 6);

function parityVisuals(
  tier: 'overview' | 'district' | 'street',
  targetCorridorWidthPx: number,
): RendererLodAcceptanceVisualCase[] {
  const visualCamera = camera(
    PORT_MASON_RENDERER_CENTER,
    rendererCaptureZoomForCorridorWidth(targetCorridorWidthPx),
    targetCorridorWidthPx,
  );
  return (['live-maplibre', 'static-maplibre', 'svg'] as const).map((surface) =>
    visual(
      `parity-${tier}-${surface === 'live-maplibre' ? 'live' : surface === 'static-maplibre' ? 'static' : 'svg'}`,
      'port-mason',
      surface,
      visualCamera,
    ),
  );
}

export const RENDERER_LOD_ACCEPTANCE_VISUAL_CASES: readonly RendererLodAcceptanceVisualCase[] = [
  visual('selected-wide-corridor-10-5', 'port-mason', 'live-maplibre', SELECTED_CAMERA, 'selected'),
  visual('tunnel-below-12', 'grade-stack', 'live-maplibre', TUNNEL_BELOW_CAMERA),
  visual('tunnel-at-12', 'grade-stack', 'live-maplibre', TUNNEL_AT_CAMERA),
  visual('served-junction-3-arm', 'served-three-arm', 'live-maplibre', JUNCTION_CAMERA),
  visual('served-junction-4-arm', 'served-four-arm', 'live-maplibre', JUNCTION_CAMERA),
  visual('served-junction-5-arm', 'served-five-arm', 'live-maplibre', JUNCTION_CAMERA),
  visual('fast-pan-accepted', 'port-mason', 'live-maplibre', PAN_CAMERA),
  visual('fast-pan-edge-preload', 'port-mason', 'live-maplibre', PAN_EDGE_CAMERA, 'moving'),
  visual('fast-pan-settled', 'port-mason', 'live-maplibre', PAN_SETTLED_CAMERA),
  visual('bank-old-accepted', 'port-mason', 'live-maplibre', PAN_CAMERA, 'bank-old'),
  visual('bank-hidden-preparation', 'port-mason', 'live-maplibre', PAN_CAMERA, 'bank-preparing'),
  visual('bank-new-promoted', 'port-mason', 'live-maplibre', PAN_CAMERA, 'bank-new'),
  ...parityVisuals('overview', 1),
  ...parityVisuals('district', 6),
  ...parityVisuals('street', 13),
];

export interface RendererLodAcceptancePlan {
  readonly suiteId: typeof RENDERER_LOD_ACCEPTANCE_SUITE_ID;
  readonly phase: typeof RENDERER_LOD_ACCEPTANCE_PHASE;
  readonly profile: PerfProfileId;
  readonly visuals: readonly RendererLodAcceptanceVisualCase[];
  readonly assertionIds: readonly RendererLodAcceptanceAssertionId[];
}

export function createRendererLodAcceptancePlan(): RendererLodAcceptancePlan {
  return {
    suiteId: RENDERER_LOD_ACCEPTANCE_SUITE_ID,
    phase: RENDERER_LOD_ACCEPTANCE_PHASE,
    profile: 'desktop',
    visuals: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
    assertionIds: RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS,
  };
}
