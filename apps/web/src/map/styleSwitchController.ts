import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { MAP_THEMES, layerSpecsForScheme } from './mapTheme';

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
    layers: [
      ...(nextStyle.layers ?? []).filter((layer) => !layer.id.startsWith('tm-')),
      ...themedLayers,
    ],
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
  const fetchStyle = options.fetchStyle ?? fetchStyleDocument;

  const apply = async (scheme: ColorScheme): Promise<void> => {
    if (disposed) return;
    if (scheme === appliedScheme && activeRequest === undefined) {
      pendingScheme = undefined;
      return;
    }
    if (options.isInteractionActive()) {
      pendingScheme = scheme;
      return;
    }

    pendingScheme = undefined;
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

  return {
    request: apply,
    flush: async () => {
      if (pendingScheme && !options.isInteractionActive()) await apply(pendingScheme);
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
