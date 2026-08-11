import { laneKind } from '@transitmapper/core/model/catalog';
import { widthPxAtZ14 } from '@transitmapper/core/render/constants';
import type { PerfProfileId } from './types';
import { PORT_MASON_RENDERER_CENTER } from './renderer-port-mason-fixture';

export type RendererCaptureTheme = 'light' | 'dark';
export type RendererCaptureViewMode = 'infrastructure' | 'network' | 'diagram';
type RendererCaptureDetail =
  'overview' | 'overview-district' | 'district' | 'district-street' | 'street';

export interface RendererCaptureCase {
  id: string;
  phase: string;
  profile: PerfProfileId;
  theme: RendererCaptureTheme;
  viewMode: RendererCaptureViewMode;
  detail: RendererCaptureDetail;
  /** Displayed width of the fixture's reference road at this camera. */
  targetCorridorWidthPx: number;
  zoom: number;
}

type RendererFilmstripBoundary = 'overview-district' | 'district-street';

export interface RendererFilmstripCase {
  id: string;
  phase: string;
  viewMode: RendererCaptureViewMode;
  boundary: RendererFilmstripBoundary;
  frame: number;
  /** Expected displayed width of the fixture's reference road in CSS pixels. */
  targetCorridorWidthPx: number;
  zoom: number;
}

type RendererContextSurface = 'editor' | 'export' | 'onboarding' | 'embed';

export interface RendererContextCase {
  id: string;
  phase: string;
  profile: PerfProfileId;
  theme: RendererCaptureTheme;
  surface: RendererContextSurface;
}

export function rendererCaptureFilename(capture: RendererCaptureCase): string {
  return `${capture.profile}-${capture.theme}-${capture.viewMode}-${capture.detail}.png`;
}

export function rendererFilmstripFilename(capture: RendererFilmstripCase): string {
  return `filmstrip-${capture.viewMode}-${capture.boundary}-${capture.frame}.png`;
}

export function rendererContextFilename(capture: RendererContextCase): string {
  return `context-${capture.profile}-${capture.theme}-${capture.surface}.png`;
}

export function rendererFixtureFilename(fixtureId: string): string {
  return `fixture-${fixtureId}.png`;
}

interface RendererCaptureDetailSample {
  detail: RendererCaptureDetail;
  targetCorridorWidthPx: number;
  zoom: number;
}

export interface RendererCaptureComparisonPaths {
  baselinePath?: string;
  previousPath?: string;
  currentPath: string;
  differencePath?: string;
}

export interface RendererCaptureComparison {
  label: 'Baseline' | 'Previous' | 'Current' | 'Difference';
  path: string;
}

export interface RendererCaptureSelection {
  profile: PerfProfileId | 'all';
  theme: RendererCaptureTheme | 'all';
}

const PROFILES: readonly PerfProfileId[] = ['desktop', 'mobile'];
const THEMES: readonly RendererCaptureTheme[] = ['light', 'dark'];
const VIEW_MODES: readonly RendererCaptureViewMode[] = ['infrastructure', 'network', 'diagram'];
const PORT_MASON_REFERENCE_ROAD_WIDTH_M =
  laneKind('drive').defaultWidthM * 4 + laneKind('sidewalk').defaultWidthM * 2;
const PORT_MASON_REFERENCE_ROAD_WIDTH_AT_Z14_PX = widthPxAtZ14(
  PORT_MASON_REFERENCE_ROAD_WIDTH_M,
  PORT_MASON_RENDERER_CENTER[1],
);

/** Converts a screen-space evidence target to the camera zoom at which the
 * default Port Mason road reaches it. Keeping the capture cameras tied to the
 * physical fixture prevents a profile or latitude change from silently moving
 * the LOD transition out of the filmstrip that is meant to prove it. */
export function rendererCaptureZoomForCorridorWidth(targetWidthPx: number): number {
  if (!Number.isFinite(targetWidthPx) || targetWidthPx <= 0) {
    throw new RangeError('Renderer capture corridor width must be finite and positive.');
  }
  return 14 + Math.log2(targetWidthPx / PORT_MASON_REFERENCE_ROAD_WIDTH_AT_Z14_PX);
}

const DETAIL_SAMPLES: readonly RendererCaptureDetailSample[] = [
  {
    detail: 'overview',
    targetCorridorWidthPx: PORT_MASON_REFERENCE_ROAD_WIDTH_AT_Z14_PX * 2 ** (11 - 14),
    zoom: 11,
  },
  {
    detail: 'overview-district',
    targetCorridorWidthPx: 3,
    zoom: rendererCaptureZoomForCorridorWidth(3),
  },
  {
    detail: 'district',
    targetCorridorWidthPx: 6,
    zoom: rendererCaptureZoomForCorridorWidth(6),
  },
  {
    detail: 'district-street',
    targetCorridorWidthPx: 10.5,
    zoom: rendererCaptureZoomForCorridorWidth(10.5),
  },
  {
    detail: 'street',
    targetCorridorWidthPx: PORT_MASON_REFERENCE_ROAD_WIDTH_AT_Z14_PX * 2 ** (18 - 14),
    zoom: 18,
  },
];
const FILMSTRIP_BOUNDARIES: readonly {
  boundary: RendererFilmstripBoundary;
  targetWidthsPx: readonly number[];
}[] = [
  { boundary: 'overview-district', targetWidthsPx: [1.75, 2, 3, 4, 4.5] },
  { boundary: 'district-street', targetWidthsPx: [8, 9, 10.5, 12, 13] },
];
const CONTEXT_SURFACES: readonly RendererContextSurface[] = [
  'editor',
  'export',
  'onboarding',
  'embed',
];

/** The fixed editor matrix used for every renderer phase. A phase label only
 * changes artifact names; cameras and ordering remain stable so contact
 * sheets compare like with like. */
export function createRendererCapturePlan(phase: string): RendererCaptureCase[] {
  const captures: RendererCaptureCase[] = [];
  for (const profile of PROFILES) {
    for (const theme of THEMES) {
      for (const viewMode of VIEW_MODES) {
        for (const sample of DETAIL_SAMPLES) {
          captures.push({
            id: `${phase}-${profile}-${theme}-${viewMode}-${sample.detail}`,
            phase,
            profile,
            theme,
            viewMode,
            detail: sample.detail,
            targetCorridorWidthPx: sample.targetCorridorWidthPx,
            zoom: sample.zoom,
          });
        }
      }
    }
  }
  return captures;
}

/** Fractional zoom frames make popping and unstable ordering reviewable.
 * These baseline camera bands are kept fixed across phases; screen-space LOD
 * work can move what blends inside them without moving the evidence camera. */
export function createRendererFilmstripPlan(phase: string): RendererFilmstripCase[] {
  const captures: RendererFilmstripCase[] = [];
  for (const viewMode of VIEW_MODES) {
    for (const { boundary, targetWidthsPx } of FILMSTRIP_BOUNDARIES) {
      for (let frame = 0; frame < targetWidthsPx.length; frame++) {
        const targetCorridorWidthPx = targetWidthsPx[frame];
        captures.push({
          id: `${phase}-filmstrip-${viewMode}-${boundary}-${frame}`,
          phase,
          viewMode,
          boundary,
          frame,
          targetCorridorWidthPx,
          zoom: rendererCaptureZoomForCorridorWidth(targetCorridorWidthPx),
        });
      }
    }
  }
  return captures;
}

export function createRendererContextPlan(phase: string): RendererContextCase[] {
  const captures: RendererContextCase[] = [];
  for (const profile of PROFILES) {
    for (const theme of THEMES) {
      for (const surface of CONTEXT_SURFACES) {
        captures.push({
          id: `${phase}-context-${profile}-${theme}-${surface}`,
          phase,
          profile,
          theme,
          surface,
        });
      }
    }
  }
  return captures;
}

export function selectRendererCaptureCases(
  captures: readonly RendererCaptureCase[],
  selection: RendererCaptureSelection,
): RendererCaptureCase[] {
  return captures.filter(
    (capture) =>
      (selection.profile === 'all' || capture.profile === selection.profile) &&
      (selection.theme === 'all' || capture.theme === selection.theme),
  );
}

/** Contact sheets always tell the same visual story even when an early phase
 * has no previous or difference artifact yet. */
export function rendererCaptureComparisons(
  paths: RendererCaptureComparisonPaths,
): RendererCaptureComparison[] {
  const comparisons: Array<RendererCaptureComparison | undefined> = [
    paths.baselinePath ? { label: 'Baseline', path: paths.baselinePath } : undefined,
    paths.previousPath ? { label: 'Previous', path: paths.previousPath } : undefined,
    { label: 'Current', path: paths.currentPath },
    paths.differencePath ? { label: 'Difference', path: paths.differencePath } : undefined,
  ];
  return comparisons.filter((comparison): comparison is RendererCaptureComparison => !!comparison);
}
