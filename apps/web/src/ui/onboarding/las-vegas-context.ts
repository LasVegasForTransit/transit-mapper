import type { LngLat } from '@transitmapper/core/model/system';
import contextData from './las-vegas-context-data.json';

type OnboardingContextKind = 'motorway' | 'major' | 'street' | 'rail';

interface OnboardingContextProperties {
  osmWayId: number;
  name: string | null;
  kind: OnboardingContextKind;
  part: number;
}

interface OnboardingContextBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface OnboardingContextSnapshot {
  attribution: string;
  sourceUrl: string;
  generatedAt: string;
  bounds: OnboardingContextBounds;
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, OnboardingContextProperties>;
}

/** Generated data is checked once at the browser boundary. Keeping it as a
 * committed snapshot gives onboarding real map evidence without adding a
 * network request or allowing upstream OSM edits to change a release. */
function snapshotFrom(value: unknown): OnboardingContextSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('Missing onboarding map data');
  const candidate = value as Partial<OnboardingContextSnapshot>;
  if (
    typeof candidate.attribution !== 'string' ||
    typeof candidate.sourceUrl !== 'string' ||
    typeof candidate.generatedAt !== 'string' ||
    candidate.featureCollection?.type !== 'FeatureCollection' ||
    !Array.isArray(candidate.featureCollection.features) ||
    !candidate.bounds
  ) {
    throw new Error('Invalid onboarding map snapshot');
  }
  return candidate as OnboardingContextSnapshot;
}

const snapshot = snapshotFrom(contextData);

export const ONBOARDING_CONTEXT_ATTRIBUTION = snapshot.attribution;
export const ONBOARDING_CONTEXT_SOURCE_URL = snapshot.sourceUrl;
export const ONBOARDING_CONTEXT_BOUNDS = snapshot.bounds;
export const ONBOARDING_STREET_FEATURES = snapshot.featureCollection;

export interface OnboardingPlaceLabel {
  id: string;
  label: string;
  coord: LngLat;
  priority: 'primary' | 'secondary';
}

/** Labels name actual districts and destinations in the fixed map frame.
 * They are deliberately sparse so the service remains more prominent than
 * the context snapshot. */
export const ONBOARDING_PLACE_LABELS: OnboardingPlaceLabel[] = [
  {
    id: 'medical-district',
    label: 'Medical District',
    coord: [-115.1655, 36.1645],
    priority: 'primary',
  },
  {
    id: 'arts-district',
    label: 'Arts District',
    coord: [-115.1572, 36.154],
    priority: 'secondary',
  },
  { id: 'downtown', label: 'Downtown', coord: [-115.1396, 36.1717], priority: 'primary' },
  {
    id: 'charleston-boulevard',
    label: 'Charleston Boulevard',
    coord: [-115.1537, 36.1585],
    priority: 'secondary',
  },
  {
    id: 'las-vegas-boulevard',
    label: 'Las Vegas Boulevard',
    coord: [-115.1435, 36.1643],
    priority: 'secondary',
  },
  {
    id: 'fremont-street',
    label: 'Fremont Street',
    coord: [-115.1332, 36.1694],
    priority: 'secondary',
  },
  {
    id: 'symphony-park',
    label: 'Symphony Park',
    coord: [-115.153, 36.1724],
    priority: 'secondary',
  },
  { id: 'huntridge', label: 'Huntridge', coord: [-115.1264, 36.1558], priority: 'primary' },
];
