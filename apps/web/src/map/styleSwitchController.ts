import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { layerSpecsForScheme, localBlankStyleForScheme, MAP_THEMES } from './mapTheme';

export interface StyleSwitchMap {
  getStyle(): StyleSpecification;
  setStyle(
    style: StyleSpecification,
    options?: {
      diff?: boolean;
      transformStyle?: (
        previousStyle: StyleSpecification | undefined,
        nextStyle: StyleSpecification,
      ) => StyleSpecification;
    },
  ): unknown;
}

export interface StyleSwitchControllerOptions {
  map: StyleSwitchMap;
  initialScheme?: ColorScheme;
  fetchStyle?: (url: string, signal: AbortSignal) => Promise<StyleSpecification>;
  layerSpecs?: (scheme: ColorScheme) => LayerSpecification[];
  isInteractionActive: () => boolean;
  recover?: (scheme: ColorScheme, fullRebuild: boolean) => void;
  onUnavailable?: (scheme: ColorScheme, error: Error) => void;
}

export interface StyleSwitchController {
  request(scheme: ColorScheme): Promise<void>;
  flush(): Promise<void>;
  lockToLocal(scheme: ColorScheme): void;
  dispose(): void;
}

async function fetchStyleDocument(url: string, signal: AbortSignal): Promise<StyleSpecification> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Basemap style request failed (${response.status})`);
  return (await response.json()) as StyleSpecification;
}

/** Carry only app-owned runtime state. Basemap sources and layers always come
 * from the newly fetched OpenFreeMap style, while the live GeoJSON source
 * objects retain their current feature data. */
export function carryTransitMapperStyle(
  previousStyle: StyleSpecification | undefined,
  nextStyle: StyleSpecification,
  themedLayers: LayerSpecification[],
): StyleSpecification {
  const sources = { ...nextStyle.sources };
  for (const [id, source] of Object.entries(previousStyle?.sources ?? {})) {
    if (id.startsWith('tm-')) sources[id] = source;
  }
  return {
    ...nextStyle,
    sources,
    layers: [...nextStyle.layers.filter((layer) => !layer.id.startsWith('tm-')), ...themedLayers],
  };
}

export function createStyleSwitchController(
  options: StyleSwitchControllerOptions,
): StyleSwitchController {
  let disposed = false;
  let generation = 0;
  let activeRequest: AbortController | undefined;
  let pendingScheme: ColorScheme | undefined;
  let appliedScheme = options.initialScheme;
  let localOnly = false;
  const fetchStyle = options.fetchStyle ?? fetchStyleDocument;

  const cancelActiveRequest = () => {
    if (!activeRequest) return;
    // Invalidate the generation even if a custom fetch implementation ignores
    // AbortSignal. Its eventual response must not replace a newer request.
    generation += 1;
    activeRequest.abort();
    activeRequest = undefined;
  };

  const commitStyle = (scheme: ColorScheme, nextStyle: StyleSpecification): void => {
    const themedLayers = (options.layerSpecs ?? layerSpecsForScheme)(scheme);
    try {
      options.map.setStyle(nextStyle, {
        diff: true,
        transformStyle: (previousStyle, incomingStyle) =>
          carryTransitMapperStyle(previousStyle, incomingStyle, themedLayers),
      });
      appliedScheme = scheme;
      options.recover?.(scheme, false);
    } catch {
      try {
        options.map.setStyle(nextStyle, { diff: false });
        appliedScheme = scheme;
        options.recover?.(scheme, true);
      } catch (error) {
        options.onUnavailable?.(
          scheme,
          error instanceof Error ? error : new Error('Basemap style could not be applied'),
        );
      }
    }
  };

  const apply = async (scheme: ColorScheme): Promise<void> => {
    if (disposed) return;
    if (options.isInteractionActive()) {
      cancelActiveRequest();
      // Reversing to the style that is still on screen cancels the queued
      // switch altogether. Any other latest request waits for release.
      pendingScheme = scheme === appliedScheme ? undefined : scheme;
      return;
    }
    if (scheme === appliedScheme) {
      cancelActiveRequest();
      pendingScheme = undefined;
      return;
    }

    pendingScheme = undefined;
    if (localOnly) {
      commitStyle(scheme, localBlankStyleForScheme(scheme));
      return;
    }
    const requestGeneration = ++generation;
    activeRequest?.abort();
    const abortController = new AbortController();
    activeRequest = abortController;

    let nextStyle: StyleSpecification;
    try {
      nextStyle = await fetchStyle(MAP_THEMES[scheme].basemapStyle, abortController.signal);
    } catch (error) {
      if (
        disposed ||
        requestGeneration !== generation ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      options.onUnavailable?.(
        scheme,
        error instanceof Error ? error : new Error('Basemap style request failed'),
      );
      if (requestGeneration === generation) activeRequest = undefined;
      return;
    }

    if (disposed || requestGeneration !== generation) return;
    activeRequest = undefined;
    if (options.isInteractionActive()) {
      pendingScheme = scheme;
      return;
    }

    commitStyle(scheme, nextStyle);
  };

  return {
    request: apply,
    flush: async () => {
      if (pendingScheme && !options.isInteractionActive()) await apply(pendingScheme);
    },
    lockToLocal: (scheme) => {
      if (disposed) return;
      localOnly = true;
      cancelActiveRequest();
      pendingScheme = undefined;
      appliedScheme = scheme;
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      activeRequest?.abort();
      activeRequest = undefined;
      pendingScheme = undefined;
    },
  };
}
