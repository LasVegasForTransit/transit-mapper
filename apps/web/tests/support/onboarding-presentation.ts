import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';

/**
 * The onboarding preview derives its presentation from a real fitted map
 * (`renderPresentationForFittedMap`), which no unit test has. This stands in
 * for one at the framing onboarding actually uses: the downtown Las Vegas
 * fixture inside the dialog's preview panel.
 */
export const ONBOARDING_TEST_PRESENTATION = renderPresentationForViewport({
  center: [-115.1435, 36.165],
  zoom: 14,
  width: 640,
  height: 360,
});
