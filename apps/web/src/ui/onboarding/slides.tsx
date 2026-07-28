import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { IconName } from '../Icon';

/** How a slide illustrates itself. `triPreview` and `singlePreview` both
 *  render a live `OnboardingPreviewMap` against the shared fixture system —
 *  `icons` is the one deliberate exception (slide 4: there's no natural
 *  live-preview moment for "import data" or "share a link"). */
export type OnboardingSlideVisual =
  | { kind: 'triPreview' }
  | { kind: 'singlePreview'; viewMode: ViewOptions['viewMode']; animateVehicle?: boolean }
  | { kind: 'icons'; icons: [IconName, IconName] };

export interface OnboardingSlideData {
  title: string;
  body: string;
  visual: OnboardingSlideVisual;
}

export const ONBOARDING_SLIDES: OnboardingSlideData[] = [
  {
    title: 'One system, three views',
    body: 'Every system you build is one model, shown three ways. Infrastructure is the real streets and rail. Network is what riders see: colored lines and stops. Diagram straightens it into a clean, read-only summary.',
    visual: { kind: 'triPreview' },
  },
  {
    title: 'Draw your streets and rail',
    body: 'Pick Road, Track, or Path and draw over your streets. Cross one with another and a junction forms on its own — no manual splitting.',
    visual: { kind: 'singlePreview', viewMode: 'infrastructure' },
  },
  {
    title: 'Draw a line, watch it run',
    body: 'Draw a service line on top of what you built. Give it a name and a color, then press play to see it move on a schedule.',
    visual: { kind: 'singlePreview', viewMode: 'network', animateVehicle: true },
  },
  {
    title: 'Bring in real data, or share what you made',
    body: "Import a slice of OpenStreetMap or a GTFS feed to jump-start a system. When you're ready, share a link or export an image.",
    visual: { kind: 'icons', icons: ['download', 'share'] },
  },
];
