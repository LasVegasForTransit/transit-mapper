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
  const initialColorSchemeRef = useRef(colorScheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReturnType<typeof mountOnboardingMap> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setFailed(false);
    const controller = mountOnboardingMap({
      container: containerRef.current,
      colorScheme: initialColorSchemeRef.current,
      onFailure: (error) => {
        console.error('[onboarding preview]', error);
        setFailed(true);
      },
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    controllerRef.current?.setColorScheme(colorScheme);
  }, [colorScheme]);

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
