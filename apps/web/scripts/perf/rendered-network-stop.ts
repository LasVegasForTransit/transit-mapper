import type { LngLat } from '@transitmapper/core/model/system';
import type { Page } from 'playwright-core';
import type { PerfPageWindow } from './browserContract';

export interface RenderedNetworkStopCandidate {
  readonly id: string;
  readonly coord: LngLat;
}

export interface RenderedNetworkStopInspection {
  readonly id: string;
  readonly layerIds: readonly string[];
}

export function selectRenderedNetworkStopId(
  inspected: readonly RenderedNetworkStopInspection[],
): string | null {
  return (
    inspected.find((stop) =>
      stop.layerIds.some((layerId) => layerId.startsWith('tm-stations--bank-')),
    )?.id ?? null
  );
}

/** Resolves the model candidate that MapLibre has kept after Network-view
 * density selection. A valid service relationship alone does not prove that
 * a person can click the stop at the current camera scale. */
export async function renderedNetworkStopId(
  page: Page,
  candidates: readonly RenderedNetworkStopCandidate[],
): Promise<{
  readonly id: string | null;
  readonly inspected: readonly RenderedNetworkStopInspection[];
}> {
  const inspected = await page.evaluate((candidateStops): RenderedNetworkStopInspection[] => {
    const renderedFeaturesAt = (window as PerfPageWindow).__perfRenderedFeaturesAt;
    if (!renderedFeaturesAt) throw new Error('The rendered-feature seam is unavailable.');
    return candidateStops.map((stop) => ({
      id: stop.id,
      layerIds: renderedFeaturesAt(stop.coord)
        .filter((feature) => feature.properties.id === stop.id)
        .map((feature) => feature.layerId),
    }));
  }, candidates);
  return { id: selectRenderedNetworkStopId(inspected), inspected };
}
