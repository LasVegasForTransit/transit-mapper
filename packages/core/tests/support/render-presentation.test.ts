import { renderPresentationForViewport } from '../../src/render/render-presentation';

export const OVERVIEW_TEST_PRESENTATION = renderPresentationForViewport({
  center: [-115.15, 36.14],
  zoom: 8,
  width: 1_440,
  height: 900,
});

export const STREET_TEST_PRESENTATION = renderPresentationForViewport({
  center: [-115.15, 36.14],
  zoom: 20,
  width: 1_440,
  height: 900,
});
