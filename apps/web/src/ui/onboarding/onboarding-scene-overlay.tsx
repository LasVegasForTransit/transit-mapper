import { OnboardingServiceInspectorPreview } from './onboarding-service-inspector-preview';
import type { OnboardingSceneId } from './slides';

interface OnboardingSceneOverlayProps {
  scene: OnboardingSceneId;
  failed: boolean;
  description: string;
}

/** Onboarding is map-only except where it renders the real Service inspector
 * Schedule presentation. Failures stay plain so they cannot resemble product
 * controls that do not exist. */
export function OnboardingSceneOverlay({
  scene,
  failed,
  description,
}: OnboardingSceneOverlayProps) {
  if (failed) return <p className="onboarding-preview-fallback">{description}</p>;
  if (scene === 'operations') return <OnboardingServiceInspectorPreview />;
  return null;
}
