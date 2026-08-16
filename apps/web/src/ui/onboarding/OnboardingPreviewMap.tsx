import { useEffect, useRef, useState } from 'react';
import { useSystemColorScheme } from '../../theme/systemColorScheme';
import { mountOnboardingMap } from './onboarding-map-controller';
import { OnboardingSceneOverlay } from './onboarding-scene-overlay';
import type { OnboardingSceneId } from './slides';

interface OnboardingPreviewMapProps {
  scene: OnboardingSceneId;
  description: string;
  className?: string;
}

/** React presents accessible state while the controller owns the short-lived
 * local MapLibre instance and every resource attached to it. */
export function OnboardingPreviewMap({
  scene,
  description,
  className = '',
}: OnboardingPreviewMapProps) {
  const colorScheme = useSystemColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setFailed(false);
    return mountOnboardingMap({
      container: containerRef.current,
      colorScheme,
      scene,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onFailure: (error) => {
        console.error('[onboarding preview]', error);
        setFailed(true);
      },
    });
  }, [colorScheme, scene]);

  return (
    <div
      className={`onboarding-scene onboarding-scene-${scene} ${className}`.trim()}
      role="img"
      aria-label={description}
    >
      <div className="onboarding-map-frame" aria-hidden="true">
        {!failed ? <div ref={containerRef} className="onboarding-preview-map" /> : null}
      </div>
      <OnboardingSceneOverlay scene={scene} failed={failed} description={description} />
    </div>
  );
}
