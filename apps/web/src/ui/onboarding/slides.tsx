import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';

/** Every slide renders a live `OnboardingPreviewMap` against the same fixture
 *  system, either as one generous view or as the final three-view comparison. */
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
  /** Quiet release-stability context shown only where the slide needs it. */
  note?: string;
  visual: OnboardingSlideVisual;
}

export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    title: 'Welcome to TransitMapper',
    body: 'TransitMapper helps you turn an idea for better transit into a map you can explore and refine. Sketch the routes your community needs, then add streets, tracks, stops, and stops as the plan takes shape.',
    note: 'Open beta: features and workflows may change frequently before a stable release.',
    visual: { kind: 'singlePreview', viewMode: 'network' },
  },
  {
    title: 'Sketch the routes your community needs',
    body: 'Start in Network to draw the lines people would ride. Name each route, choose its color, add stops and a schedule, then press play to see service move. Keep the first pass rough. You can work out the physical details later.',
    visual: {
      kind: 'singlePreview',
      viewMode: 'network',
      animateVehicle: true,
      key: 'service',
    },
  },
  {
    title: 'Add the streets and rail underneath',
    body: 'Switch to Infrastructure to place routes on real roads and tracks. Draw the physical network yourself, or import real streets instead of starting from scratch. Crossings become junctions as you build.',
    visual: { kind: 'singlePreview', viewMode: 'infrastructure', key: 'infrastructure' },
  },
  {
    title: 'See the same system three ways',
    body: 'Use Network for routes and stops, Infrastructure for streets, tracks, and stops, and Diagram for a clean overview. Everything stays connected. Share a link or export an image when you are ready to bring other people into the conversation.',
    visual: { kind: 'triPreview' },
  },
];
