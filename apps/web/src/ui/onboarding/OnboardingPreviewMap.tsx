import { useEffect, useRef, useState } from 'react';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ViewOptions } from '../../map/layers';
import { useSystemColorScheme } from '../../theme/systemColorScheme';
import { mountOnboardingMap } from './onboarding-map-controller';
import { OnboardingSceneOverlay } from './onboarding-scene-overlay';
import type { OnboardingSceneId } from './slides';

interface OnboardingPreviewMapProps {
  scene?: OnboardingSceneId;
  description?: string;
  className?: string;
  /** Compatibility inputs removed with the old multi-map dialog in the next
   * task, after that presentation has its own failing behavior test. */
  system?: TransitSystem;
  view?: ViewOptions;
  animateVehicle?: boolean;
}

function inferLegacyScene(
  view: ViewOptions | undefined,
  animateVehicle: boolean,
): OnboardingSceneId {
  if (view?.viewMode === 'infrastructure') return 'infrastructure';
  return animateVehicle ? 'simulate' : 'draw';
}

/** React presents accessible state while the controller owns the short-lived
 * local MapLibre instance and every resource attached to it. */
export function OnboardingPreviewMap({
  scene,
  description = 'A Port Mason transit proposal.',
  className = '',
  system,
  view,
  animateVehicle = false,
}: OnboardingPreviewMapProps) {
  const colorScheme = useSystemColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [clockLabel, setClockLabel] = useState('6:00 AM');
  const resolvedScene = scene ?? inferLegacyScene(view, animateVehicle);

  useEffect(() => {
    if (!containerRef.current) return;
    setFailed(false);
    return mountOnboardingMap({
      container: containerRef.current,
      colorScheme,
      scene: resolvedScene,
      system,
      view,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onFailure: (error) => {
        console.error('[onboarding preview]', error);
        setFailed(true);
      },
      onClockChange: setClockLabel,
    });
  }, [colorScheme, resolvedScene, system, view]);

  return (
    <div className={`onboarding-scene ${className}`.trim()} role="img" aria-label={description}>
      <div className="onboarding-map-frame" aria-hidden="true">
        {!failed ? <div ref={containerRef} className="onboarding-preview-map" /> : null}
      </div>
      <OnboardingSceneOverlay
        scene={resolvedScene}
        failed={failed}
        description={description}
        clockLabel={clockLabel}
      />
    </div>
  );
}
