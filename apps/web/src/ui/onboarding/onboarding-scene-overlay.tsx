import { useEffect, useState } from 'react';
import { mediaQuery } from '@transitmapper/workspace/media-query-store';
import { SimControlsPresentation } from '../SimControls';
import { OnboardingServiceInspectorPreview } from './onboarding-service-inspector-preview';
import { onboardingSceneFrame } from './scene-timing';
import type { OnboardingSceneId } from './slides';

interface OnboardingSceneOverlayProps {
  scene: OnboardingSceneId;
  failed: boolean;
  description: string;
}

function OnboardingSimulationControls() {
  const reducedMotion = mediaQuery('(prefers-reduced-motion: reduce)').snapshot();
  const [simMs, setSimMs] = useState(
    () => onboardingSceneFrame('simulate', 0, reducedMotion).simMs,
  );

  useEffect(() => {
    if (reducedMotion || typeof requestAnimationFrame === 'undefined') return;
    const startedAt = performance.now();
    let lastTextUpdate = startedAt;
    let animationFrame: number;
    const update = (now: number) => {
      // The map itself remains smooth; four text updates per second are enough
      // to make the clock visibly live without rebuilding this control at 60Hz.
      if (now - lastTextUpdate >= 250) {
        setSimMs(onboardingSceneFrame('simulate', now - startedAt, false).simMs);
        lastTextUpdate = now;
      }
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [reducedMotion]);

  return (
    <div className="onboarding-sim-controls" aria-hidden="true">
      <SimControlsPresentation
        paused={false}
        speedId="4x"
        simMs={simMs}
        onTogglePaused={() => undefined}
        onSpeedChange={() => undefined}
        readOnly
      />
    </div>
  );
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
  if (scene === 'simulate') return <OnboardingSimulationControls />;
  return null;
}
