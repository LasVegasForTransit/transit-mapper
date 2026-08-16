// Excluded from the test run by vitest.config.ts (`tests/support/**`).
// buildFeatures() requires a resolved `presentation` (the renderer boundary
// crosses into real screen-space facts). Most tests don't exercise
// camera-dependent LOD/culling, so this wrapper defaults one deterministic
// presentation for every call that doesn't supply its own. A test
// specifically about viewport-dependent rendering should pass an explicit
// `presentation: renderPresentationForViewport(vp)` instead of relying on
// the default here.
import {
  buildFeatures as buildFeaturesWithPresentation,
  type RenderViewOptions,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';

export { renderPresentationForViewport };
export type { RenderViewOptions, ViewOptions };

export const DEFAULT_TEST_RENDER_PRESENTATION = renderPresentationForViewport({
  center: [0, 0],
  zoom: 0,
  width: 1_440,
  height: 900,
});

type BuildFeaturesArguments = Parameters<typeof buildFeaturesWithPresentation>;
type TestBuildFeaturesArguments = [
  system: BuildFeaturesArguments[0],
  selection: BuildFeaturesArguments[1],
  handleWayIds: BuildFeaturesArguments[2],
  view: ViewOptions,
  physicalHandleStationId?: BuildFeaturesArguments[4],
  physicalHandleGroupId?: BuildFeaturesArguments[5],
  options?: BuildFeaturesArguments[6],
];

export function buildFeatures(
  ...args: TestBuildFeaturesArguments
): ReturnType<typeof buildFeaturesWithPresentation> {
  const [
    system,
    selection,
    handleWayIds,
    view,
    physicalHandleStationId = null,
    physicalHandleGroupId = null,
    options = {},
  ] = args;
  const resolvedView: RenderViewOptions = {
    ...view,
    presentation: view.presentation ?? DEFAULT_TEST_RENDER_PRESENTATION,
  };
  return buildFeaturesWithPresentation(
    system,
    selection,
    handleWayIds,
    resolvedView,
    physicalHandleStationId,
    physicalHandleGroupId,
    options,
  );
}
