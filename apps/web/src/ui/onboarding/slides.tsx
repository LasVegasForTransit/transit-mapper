export type OnboardingSceneId = 'welcome' | 'draw' | 'infrastructure' | 'operations' | 'simulate';
type OnboardingOutcome = 'purpose' | 'service' | 'infrastructure' | 'operations' | 'simulation';

export interface OnboardingSlideData {
  title: string;
  body: string;
  outcome: OnboardingOutcome;
  scene: OnboardingSceneId;
  /** Names the relationship conveyed by the non-interactive scene. */
  visualDescription: string;
}

/** The welcome screen establishes purpose before one central Las Vegas proposal
 * develops across four capability screens. The map supplies the evidence; the
 * copy names the action and consequence in public language. */
export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    title: 'Welcome to TransitMapper',
    body: 'TransitMapper is a tool for imagining, designing, and testing public transit systems on a real map. Start with a place and design the transit system you want to see there.',
    outcome: 'purpose',
    scene: 'welcome',
    visualDescription:
      'A completed central Las Vegas proposal connects the Medical District, Arts District, Downtown, and Huntridge with bus and light-rail services on the real street network.',
  },
  {
    title: 'Draw a line. TransitMapper finds the path.',
    body: 'Sketch the trip people should be able to make. Bus service follows streets already on the map. When new infrastructure is needed, TransitMapper creates a basic alignment you can refine.',
    outcome: 'service',
    scene: 'draw',
    visualDescription:
      'The orange Charleston Crosstown grows from the Medical District along Charleston Boulevard, then turns north on Las Vegas Boulevard to reach Downtown.',
  },
  {
    title: 'Shape the physical network.',
    body: 'Every service runs on roads or tracks. Import what already exists, create what is missing, and refine alignments, stations, grades, and crossings in Infrastructure.',
    outcome: 'infrastructure',
    scene: 'infrastructure',
    visualDescription:
      'Central Las Vegas in Infrastructure: Charleston Crosstown uses existing streets, while the blue Downtown Connector reuses the existing rail corridor and adds one new connection to Downtown.',
  },
  {
    title: 'Decide how each service runs.',
    body: 'Add stops, branches, and different service patterns. Choose how often the service runs and when it starts and ends—TransitMapper shows what that operating plan requires.',
    outcome: 'operations',
    scene: 'operations',
    visualDescription:
      'The orange Charleston Crosstown splits at Las Vegas Boulevard into Downtown and Huntridge patterns beside the real Service inspector Schedule tab, showing a 10-minute frequency, service hours, and required vehicles.',
  },
  {
    title: 'Press play and watch the system operate.',
    body: 'Vehicles follow the routes, stops, and schedules you designed. Move through the day or change the speed to see the system operating. Future versions will also let you explore how transit and land use shape each other.',
    outcome: 'simulation',
    scene: 'simulate',
    visualDescription:
      'Bus and light-rail vehicles move through central Las Vegas while the real simulation controls show the time of day and playback speed.',
  },
];
