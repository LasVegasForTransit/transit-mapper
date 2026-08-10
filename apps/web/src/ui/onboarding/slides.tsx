export type OnboardingSceneId = 'draw' | 'infrastructure' | 'operations' | 'simulate';
type OnboardingOutcome = 'service' | 'infrastructure' | 'operations' | 'simulation';

export interface OnboardingSlideData {
  title: string;
  body: string;
  outcome: OnboardingOutcome;
  scene: OnboardingSceneId;
  /** Names the relationship conveyed by the non-interactive scene. */
  visualDescription: string;
}

/** One Port Mason proposal develops across all four slides. The map supplies
 * the evidence; the copy names the action and consequence in public language. */
export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    title: 'Draw a line. TransitMapper finds the path.',
    body: 'Sketch the trip people should be able to make. Bus service follows streets already on the map. When new infrastructure is needed, TransitMapper creates a basic alignment you can refine.',
    outcome: 'service',
    scene: 'draw',
    visualDescription:
      'In Port Mason, the orange Crosstown bus line grows from West Market, follows existing streets across the river bridge, and reaches downtown.',
  },
  {
    title: 'Shape the physical network.',
    body: 'Every service runs on roads or tracks. Import what already exists, create what is missing, and refine alignments, stations, grades, and crossings in Infrastructure.',
    outcome: 'infrastructure',
    scene: 'infrastructure',
    visualDescription:
      'Port Mason in Infrastructure: Crosstown uses the street grid, while the blue Harbor Line combines an existing freight corridor with a short new downtown rail connection.',
  },
  {
    title: 'Decide how each service runs.',
    body: 'Add stops, branches, and different service patterns. Choose how often the service runs and when it starts and ends—TransitMapper shows what that operating plan requires.',
    outcome: 'operations',
    scene: 'operations',
    visualDescription:
      'The orange Crosstown service splits after Central Exchange into Eastgate and Airport branches beside the Service inspector Schedule tab, which shows a 10-minute peak headway, daytime service, and the vehicles required.',
  },
  {
    title: 'Press play and watch the system operate.',
    body: 'Vehicles follow the routes, stops, and schedules you designed. Move through the day or change the speed to see the system operating. Future versions will also let you explore how transit and land use shape each other.',
    outcome: 'simulation',
    scene: 'simulate',
    visualDescription:
      'Bus and light-rail vehicles move along the Port Mason routes, showing the schedules operating on the designed network.',
  },
];
