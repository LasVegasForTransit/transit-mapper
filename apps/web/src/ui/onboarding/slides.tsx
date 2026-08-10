import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';

export type OnboardingSceneId = 'draw' | 'infrastructure' | 'operations' | 'simulate';
export type OnboardingOutcome = 'service' | 'infrastructure' | 'operations' | 'simulation';

/** Removed with the old multi-map dialog in the presentation task. Kept here
 * while the scene data lands independently so each task stays testable. */
export type OnboardingSlideVisual =
  | { kind: 'triPreview' }
  | {
      kind: 'singlePreview';
      viewMode: ViewOptions['viewMode'];
      animateVehicle?: boolean;
      key?: 'service' | 'infrastructure';
    };

export interface OnboardingSlideData {
  title: string;
  body: string;
  /** Quiet release-stability or future-looking context shown only where needed. */
  note?: string;
  outcome: OnboardingOutcome;
  scene: OnboardingSceneId;
  /** Names the relationship conveyed by the non-interactive scene. */
  visualDescription: string;
  visual: OnboardingSlideVisual;
}

/** One Port Mason proposal develops across all four slides. The map supplies
 * the evidence; the copy names the action and consequence in public language. */
export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    title: 'Draw a line. TransitMapper finds the path.',
    body: 'Sketch the trip people should be able to make. Bus service follows streets already on the map. When new infrastructure is needed, TransitMapper creates a basic alignment you can refine.',
    note: 'Open beta: features and workflows may change frequently before a stable release.',
    outcome: 'service',
    scene: 'draw',
    visualDescription:
      'In Port Mason, the orange Crosstown bus line grows from West Market, follows existing streets across the river bridge, and reaches downtown.',
    visual: { kind: 'singlePreview', viewMode: 'network' },
  },
  {
    title: 'Shape the physical network.',
    body: 'Every service runs on roads or tracks. Import what already exists, create what is missing, and refine alignments, stations, grades, and crossings in Infrastructure.',
    outcome: 'infrastructure',
    scene: 'infrastructure',
    visualDescription:
      'Port Mason in Infrastructure: Crosstown uses the street grid, while the blue Harbor Line combines an existing freight corridor with a short new downtown rail connection.',
    visual: { kind: 'singlePreview', viewMode: 'infrastructure', key: 'infrastructure' },
  },
  {
    title: 'Decide how each service runs.',
    body: 'Add stops, branches, and different service patterns. Choose how often the service runs and when it starts and ends—TransitMapper shows what that operating plan requires.',
    outcome: 'operations',
    scene: 'operations',
    visualDescription:
      'The orange Crosstown service splits after Central Exchange into Eastgate and Airport branches, with stops and an operating card showing service every 10 minutes from 6 AM to 11 PM.',
    visual: { kind: 'singlePreview', viewMode: 'network', key: 'service' },
  },
  {
    title: 'Press play and watch the system operate.',
    body: 'Vehicles follow the routes, stops, and schedules you designed. Move through the day or change the speed to see the system operating.',
    note: 'Coming later: explore how transit and land use shape each other.',
    outcome: 'simulation',
    scene: 'simulate',
    visualDescription:
      'Bus and light-rail vehicles move along the Port Mason routes while a clock advances, showing the schedules operating on the designed network.',
    visual: { kind: 'singlePreview', viewMode: 'network', animateVehicle: true },
  },
];
