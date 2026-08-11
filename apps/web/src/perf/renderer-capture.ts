import type { PerfProfileId } from './types';

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
  zoom: number;
}

type RendererFilmstripBoundary = 'overview-district' | 'district-street';

export interface RendererFilmstripCase {
  id: string;
  phase: string;
  viewMode: RendererCaptureViewMode;
  boundary: RendererFilmstripBoundary;
  frame: number;
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
const DETAIL_SAMPLES: readonly RendererCaptureDetailSample[] = [
  { detail: 'overview', zoom: 11 },
  { detail: 'overview-district', zoom: 13.75 },
  { detail: 'district', zoom: 15 },
  { detail: 'district-street', zoom: 16.5 },
  { detail: 'street', zoom: 18 },
];
const FILMSTRIP_BOUNDARIES: readonly {
  boundary: RendererFilmstripBoundary;
  centerZoom: number;
}[] = [
  { boundary: 'overview-district', centerZoom: 13.75 },
  { boundary: 'district-street', centerZoom: 16.5 },
];
const FILMSTRIP_ZOOM_OFFSETS = [-0.5, -0.25, 0, 0.25, 0.5] as const;
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
    for (const { boundary, centerZoom } of FILMSTRIP_BOUNDARIES) {
      for (let frame = 0; frame < FILMSTRIP_ZOOM_OFFSETS.length; frame++) {
        captures.push({
          id: `${phase}-filmstrip-${viewMode}-${boundary}-${frame}`,
          phase,
          viewMode,
          boundary,
          frame,
          zoom: centerZoom + FILMSTRIP_ZOOM_OFFSETS[frame],
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
